import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { Cliente } from './entities/cliente.entity';

/**
 * Tests unitarios de ClientesService.
 *
 * Cobertura crítica:
 * - Validación de nombre persona (2+ palabras)
 * - Validación de unicidad (nombre y teléfono)
 * - Manejo de NotFound
 * - Normalización a MAYÚSCULAS
 */
describe('ClientesService', () => {
  let service: ClientesService;
  let mockQb: any;
  let mockRepo: any;

  beforeEach(async () => {
    // QueryBuilder mockeado - cadena fluida
    mockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),     // por defecto: no hay duplicado
      getMany: jest.fn().mockResolvedValue([]),
    };
    mockRepo = {
      createQueryBuilder: jest.fn(() => mockQb),
      findOne: jest.fn(),
      save: jest.fn((entity: any) => Promise.resolve({ id: 1, ...entity })),
      create: jest.fn((dto: any) => dto),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: getRepositoryToken(Cliente), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<ClientesService>(ClientesService);
  });

  // ────────────────────────────────────────────────────────────────────
  // VALIDACIÓN DE NOMBRE PERSONA
  // ────────────────────────────────────────────────────────────────────
  describe('validación nombre persona', () => {
    it('rechaza persona con un solo nombre', async () => {
      await expect(
        service.create({ nombre: 'JUAN', tipo: 'persona', telefono: '8095551111' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza persona con nombre vacío', async () => {
      await expect(
        service.create({ nombre: '', tipo: 'persona', telefono: '8095551111' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('acepta persona con dos palabras (nombre + apellido)', async () => {
      const result = await service.create({
        nombre: 'JUAN PEREZ', tipo: 'persona', telefono: '8095551111',
      } as any);
      expect(result).toBeDefined();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('acepta persona con tres o más palabras', async () => {
      const result = await service.create({
        nombre: 'JUAN CARLOS PEREZ GARCIA', tipo: 'persona', telefono: '8095551111',
      } as any);
      expect(result).toBeDefined();
    });

    it('permite empresa con un solo nombre comercial', async () => {
      const result = await service.create({
        nombre: 'STRAGUS', tipo: 'empresa', telefono: '8095551111', documento: '131239218',
      } as any);
      expect(result).toBeDefined();
    });

    it('ignora palabras de menos de 2 letras al contar (ej. iniciales)', async () => {
      // "J P" tiene 2 palabras pero ambas de 1 letra → rechazar
      await expect(
        service.create({ nombre: 'J P', tipo: 'persona', telefono: '8095551111' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // NORMALIZACIÓN A MAYÚSCULAS
  // ────────────────────────────────────────────────────────────────────
  describe('normalización nombre', () => {
    it('convierte nombre a MAYÚSCULAS', async () => {
      await service.create({
        nombre: 'juan perez', tipo: 'persona', telefono: '8095551111',
      } as any);
      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        nombre: 'JUAN PEREZ',
      }));
    });

    it('elimina espacios extra al inicio/final', async () => {
      await service.create({
        nombre: '  STRAGUS LIMITED  ', tipo: 'empresa', telefono: '8095551111', documento: '131239218',
      } as any);
      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        nombre: 'STRAGUS LIMITED',
      }));
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // UNICIDAD
  // ────────────────────────────────────────────────────────────────────
  describe('unicidad de nombre y teléfono', () => {
    it('rechaza si ya existe cliente con mismo nombre', async () => {
      mockQb.getOne.mockResolvedValueOnce({ id: 99, nombre: 'JUAN PEREZ' });
      await expect(
        service.create({ nombre: 'JUAN PEREZ', tipo: 'persona', telefono: '8095551111' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza si ya existe cliente con mismo teléfono', async () => {
      // Primera llamada (nombre): null. Segunda (teléfono): hay match
      mockQb.getOne
        .mockResolvedValueOnce(null)         // nombre OK
        .mockResolvedValueOnce({ id: 99 });  // teléfono duplicado
      await expect(
        service.create({ nombre: 'JUAN PEREZ', tipo: 'persona', telefono: '8095551111' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('no valida unicidad de teléfono si no se provee', async () => {
      mockQb.getOne.mockResolvedValue(null);
      const result = await service.create({
        nombre: 'JUAN PEREZ', tipo: 'persona',
      } as any);
      expect(result).toBeDefined();
      // Solo se llama 1 vez (para nombre), no se chequea teléfono vacío
      expect(mockQb.where).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // findOne y NotFound
  // ────────────────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('devuelve cliente cuando existe', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 42, nombre: 'ACME' });
      const c = await service.findOne(42);
      expect(c.id).toBe(42);
    });

    it('lanza NotFound cuando no existe', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // UPDATE
  // ────────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('mantiene nombre actual si no se provee', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 1, nombre: 'JUAN PEREZ', tipo: 'persona', telefono: '8090000000' });
      mockRepo.update = jest.fn().mockResolvedValue({ affected: 1 });
      await service.update(1, { ciudad: 'SANTO DOMINGO' });
      // No debería rechazar (mantiene nombre persona válido)
      expect(mockRepo.update).toHaveBeenCalled();
    });

    it('valida nombre persona en update', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 1, nombre: 'JUAN PEREZ', tipo: 'persona' });
      await expect(
        service.update(1, { nombre: 'JUAN' }),  // ahora solo 1 palabra
      ).rejects.toThrow(BadRequestException);
    });
  });
});

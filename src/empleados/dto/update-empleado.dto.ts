import { PartialType } from '@nestjs/swagger';
import { CreateEmpleadoDto } from './create-empleado.dto';

/** Misma forma que CreateEmpleadoDto pero todos los campos opcionales. */
export class UpdateEmpleadoDto extends PartialType(CreateEmpleadoDto) {}

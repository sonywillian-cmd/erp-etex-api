"""Fix urgente: cambiar comillas simples por backticks en el patch anterior
para que el SQL con strings ' ' embebidos compile.
"""
p = "/home/u372536694/apps/api/dist/produccion/produccion.service.js"
s = open(p).read()

# Patrón roto (lo que dejó mi patch anterior con comillas simples)
bad = ".where('REPLACE(l.responsable, '  ', ' ') = REPLACE(:resp, '  ', ' ')',"
good = ".where(`REPLACE(l.responsable, '  ', ' ') = REPLACE(:resp, '  ', ' ')`,"

n = s.count(bad)
print(f"Ocurrencias rotas a corregir: {n}")

if n == 0:
    # Tal vez ya esté arreglado o el patrón es ligeramente distinto
    if "REPLACE(l.responsable, '  ', ' ') = REPLACE(:resp" in s and "`REPLACE" not in s:
        print("WARN: patrón presente pero formato distinto, revisar manualmente")
    else:
        print("Ya parcheado o nada que corregir.")
else:
    s = s.replace(bad, good)
    open(p, "w").write(s)
    print(f"OK: {n} reemplazos aplicados con backticks.")

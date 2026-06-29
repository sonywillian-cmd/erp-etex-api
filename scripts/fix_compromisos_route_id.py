"""Restringe la ruta :id a solo numericos para que no capture /calendario y /alertas."""
import sys

CTRL = '/home/u372536694/apps/api/dist/compromisos/compromisos.controller.js'

s = open(CTRL).read()

replacements = [
    ("(0, common_1.Get)(':id')", "(0, common_1.Get)(':id(\\\\d+)')"),
    ("(0, common_1.Put)(':id')", "(0, common_1.Put)(':id(\\\\d+)')"),
    ("(0, common_1.Delete)(':id')", "(0, common_1.Delete)(':id(\\\\d+)')"),
]

count = 0
for old, new in replacements:
    if old in s and new not in s:
        s = s.replace(old, new, 1)
        count += 1

if count == 0 and ":id(\\\\d+)" in s:
    print('Ya estaba parcheado.')
else:
    open(CTRL, 'w').write(s)
    print(f'OK: {count} rutas :id restringidas a numericos.')

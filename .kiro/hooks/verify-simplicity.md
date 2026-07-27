# Hook sugerido — exit code 2 debería bloquear en PreToolUse (verificado en dos fuentes,
# una de ellas inusual — confírmalo en tu versión antes de confiar del todo)
Trigger: al guardar archivo / antes de acción crítica
Comando: bash scripts/verify-simplicity.sh
Nota: el script actual devuelve exit 1 en fallo, no 2. Si tu Kiro exige exactamente 2
para bloquear, cambia el "exit 1" final de verify-simplicity.sh por "exit 2".

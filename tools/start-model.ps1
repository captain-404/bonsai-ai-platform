$ErrorActionPreference = 'Stop'
if (Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue) { exit 0 }
. 'C:\AI\Bonsai2\scripts\Load-BonsaiConfig.ps1'
# One inference slot avoids competing contexts in this local creative workspace.
& 'C:\AI\Bonsai2\scripts\start_llama_server.ps1' -np 1

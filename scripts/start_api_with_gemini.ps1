param(
  [string]$Key = "",
  [string]$Model = "gemini-flash-latest",
  [int]$Port = 8787
)

$env:GEMINI_API_KEY = $Key
$env:GEMINI_MODEL = $Model
$env:PORT = $Port

Write-Host "[start_api_with_gemini] Starting API server with Gemini..."
Set-Location "$PSScriptRoot\..\apps\api"
npx tsx src/index.ts

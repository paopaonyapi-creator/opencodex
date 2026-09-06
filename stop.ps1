# PaohupByPaoZa — หยุด proxy (ดับเบิลคลิก stop.cmd)
param([switch]$NoPause)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Pause-Exit([int]$Code) {
  if ($NoPause) { exit $Code }
  Write-Host ""
  Write-Host "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง..."
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
  exit $Code
}

try {
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "ไม่เจอคำสั่ง bun"
    Pause-Exit 1
  }
  bun run src/cli/index.ts stop
  Write-Host "หยุด PaohupByPaoZa แล้ว (Codex กลับเป็นโหมดปกติ)"
  Pause-Exit 0
} catch {
  Write-Host "หยุดไม่สำเร็จ: $($_.Exception.Message)"
  Pause-Exit 1
}

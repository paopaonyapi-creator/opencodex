# PaohupByPaoZa — ดับเบิลคลิก start.cmd เพื่อเปิดใช้งาน
# - ถ้ารันอยู่แล้ว จะบอกและเปิดแดชบอร์ดให้ (ไม่ start ซ้ำ)
# - ถ้ายังไม่รัน จะ start แล้วรอจน health พร้อม แล้วเปิดเบราว์เซอร์
# - หน้าต่างค้างไว้ให้อ่านผลเสมอ (กดปุ่มใดก็ได้เพื่อปิด)
param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$Port = 10100
$Dashboard = "http://localhost:$Port/"

function Pause-Exit([int]$Code) {
  Write-Host ""
  Write-Host "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง..."
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
  exit $Code
}

function Test-Health {
  try {
    $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/healthz" -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Open-Dashboard {
  if ($NoBrowser) { return }
  Write-Host "เปิดแดชบอร์ด: $Dashboard"
  Start-Process $Dashboard
}

try {
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "ไม่เจอคำสั่ง bun"
    Write-Host "ติดตั้งจาก https://bun.sh แล้วดับเบิลคลิก start.cmd ใหม่อีกครั้ง"
    Pause-Exit 1
  }

  if (Test-Health) {
    Write-Host "PaohupByPaoZa รันอยู่แล้ว — เปิดแดชบอร์ดให้เลย"
    Write-Host $Dashboard
    Open-Dashboard
    Pause-Exit 0
  }

  Write-Host "กำลังเปิด PaohupByPaoZa ที่ $Dashboard ..."
  bun run src/cli/index.ts start --port $Port

  $deadline = (Get-Date).AddSeconds(45)
  while (-not (Test-Health)) {
    if ((Get-Date) -gt $deadline) { throw "รอ health check เกิน 45 วินาที" }
    Start-Sleep -Seconds 2
  }
  Write-Host "พร้อมแล้ว! เปิดที่ $Dashboard"
  Open-Dashboard
  Pause-Exit 0
} catch {
  Write-Host "เปิดไม่สำเร็จ: $($_.Exception.Message)"
  Write-Host "ถ้าพอร์ต $Port ถูกใช้อยู่ ให้ปิดโปรแกรมตัวเก่าก่อน หรือรัน stop.cmd"
  Pause-Exit 1
}

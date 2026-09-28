# ============================================================
#  股流 Radar - 註冊每日存檔排程（含可靠性設定）
#  週一–五 21:00 執行 scripts\run-daily-archive.bat
#
#  為什麼要這些設定：
#   - StartWhenAvailable : 21:00 電腦沒開／沒登入 → 之後開機時補跑（錯過不漏）
#   - WakeToRun          : 睡眠中會被喚醒執行
#   - 允許電池執行        : 筆電拔電源也要跑
#   （存檔腳本本身是 idempotent，補跑不會產生重複資料）
#
#  用法：
#    powershell -File register-daily-task.ps1          建立/更新
#    powershell -File register-daily-task.ps1 run      立刻執行
#    powershell -File register-daily-task.ps1 delete   刪除
# ============================================================
param([string]$Action = "create")

$TaskName = "GuliuRadar-DailyArchive"
$Legacy   = "GuliuRadar-DailyArchive-Late"
$Bat      = Join-Path $PSScriptRoot "run-daily-archive.bat"

function Remove-Task($name) {
  schtasks /Delete /TN $name /F 2>$null | Out-Null
}

if ($Action -eq "delete") {
  Remove-Task $TaskName
  Remove-Task $Legacy
  Write-Host "已刪除排程：$TaskName"
  exit 0
}

if ($Action -eq "run") {
  schtasks /Run /TN $TaskName
  exit 0
}

# 先移除舊的（含先前的補跑任務），再建立
Remove-Task $Legacy
schtasks /Create /TN $TaskName /TR "`"$Bat`"" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 21:00 /F | Out-Null

# 套用可靠性設定（透過匯出/修改/匯入 XML）
$xml = (schtasks /Query /TN $TaskName /XML) -join "`r`n"
$xml = $xml -replace "<DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>", "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"
$xml = $xml -replace "<StopIfGoingOnBatteries>true</StopIfGoingOnBatteries>", "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>"
if ($xml -notmatch "<StartWhenAvailable>") {
  $xml = $xml -replace "(<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>)", "`$1`r`n`r`n    <StartWhenAvailable>true</StartWhenAvailable>"
}
if ($xml -notmatch "<WakeToRun>") {
  $xml = $xml -replace "(<IdleSettings>)", "    <WakeToRun>true</WakeToRun>`r`n`r`n    `$1"
}
$tmp = Join-Path $env:TEMP "guliu-daily-task.xml"
[System.IO.File]::WriteAllText($tmp, $xml, [System.Text.Encoding]::Unicode)
schtasks /Create /TN $TaskName /XML $tmp /F | Out-Null

Write-Host "已建立/更新排程：$TaskName（週一–五 21:00，錯過會補跑、可喚醒電腦、允許電池）"
schtasks /Query /TN $TaskName /FO LIST | Select-String -Pattern "TaskName|Next Run Time|Status"

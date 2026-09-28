# ============================================================
#  股流 Radar - 註冊每日存檔排程（含可靠性設定）
#  週一–五 21:00 執行 scripts\run-daily-archive.bat
#
#  可靠性設定：
#   - StartWhenAvailable : 21:00 電腦沒開／沒登入 → 之後開機時補跑（錯過不漏）
#   - WakeToRun          : 睡眠中會被喚醒執行
#   - 允許電池執行        : 筆電拔電源也照跑
#   （存檔腳本 idempotent，補跑不會產生重複資料）
#
#  用法：
#    powershell -File register-daily-task.ps1          建立/更新
#    powershell -File register-daily-task.ps1 run      立刻執行
#    powershell -File register-daily-task.ps1 delete   刪除
#
#  實作說明：直接產生任務 XML 後以 schtasks /Create /XML 匯入。
#  不用 New-ScheduledTask*（在部分環境會出現 MismatchedPSTypeName），
#  也不解析 schtasks 匯出內容（前面可能夾雜空行導致匯入失敗）。
# ============================================================
param([string]$Action = "create")

$TaskName = "GuliuRadar-DailyArchive"
$Legacy   = "GuliuRadar-DailyArchive-Late"
$Bat      = (Join-Path $PSScriptRoot "run-daily-archive.bat")

if ($Action -eq "delete") {
  schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
  schtasks /Delete /TN $Legacy /F 2>$null | Out-Null
  Write-Host "已刪除排程：$TaskName"
  exit 0
}

if ($Action -eq "run") {
  schtasks /Run /TN $TaskName | Out-Null
  Write-Host "已觸發：$TaskName"
  exit 0
}

# 移除先前的補跑任務（已合併成單一排程）
schtasks /Delete /TN $Legacy /F 2>$null | Out-Null

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Guliu Radar daily archive (weekdays 21:00)</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-09-22T21:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek>
          <Monday />
          <Tuesday />
          <Wednesday />
          <Thursday />
          <Friday />
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$env:USERDOMAIN\$env:USERNAME</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$Bat</Command>
    </Exec>
  </Actions>
</Task>
"@

$tmp = Join-Path $env:TEMP "guliu-daily-task.xml"
[System.IO.File]::WriteAllText($tmp, $xml, [System.Text.Encoding]::Unicode)

$out = schtasks /Create /TN $TaskName /XML $tmp /F 2>&1
Write-Host $out

# 驗證
$verify = (schtasks /Query /TN $TaskName /XML 2>&1) -join "`n"
$okStart = $verify -match "<StartWhenAvailable>true</StartWhenAvailable>"
$okWake  = $verify -match "<WakeToRun>true</WakeToRun>"
$okBatt  = $verify -match "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"
schtasks /Query /TN $TaskName /FO LIST | Select-String -Pattern "TaskName|Next Run Time|Status"
Write-Host ("驗證：StartWhenAvailable={0} WakeToRun={1} 允許電池={2}" -f $okStart, $okWake, $okBatt)

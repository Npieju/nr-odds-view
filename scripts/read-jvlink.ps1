param([Parameter(Mandatory=$true)][ValidatePattern('^\d{16}$')][string]$RaceKey)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$jv = $null
$opened = $false
try {
    # Match this host's architecture to installed JV-Link (64-bit/32-bit).
    $jv = New-Object -ComObject JVDTLab.JVLink
    $rc = $jv.JVInit('UNKNOWN')
    if ($rc -ne 0) { throw "JVInit returned $rc" }
    $started = [DateTimeOffset]::UtcNow.ToString('o')
    $rc = $jv.JVRTOpen('0B31', $RaceKey)
    if ($rc -ne 0) { throw "JVRTOpen returned $rc" }
    $opened = $true
    $records = [System.Collections.Generic.List[object]]::new()
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        if ($timer.Elapsed.TotalSeconds -gt 30) { throw 'JVRead timed out' }
        $buffer = [string]::new([char]0, 110000)
        $filename = ''
        $rc = $jv.JVRead([ref]$buffer, 110000, [ref]$filename)
        $received = [DateTimeOffset]::UtcNow.ToString('o')
        if ($rc -eq 0) { break }
        if ($rc -eq -1) { continue }
        if ($rc -eq -3) { Start-Sleep -Milliseconds 200; continue }
        if ($rc -lt 0) { throw "JVRead returned $rc" }
        if ($rc -ne 962) { throw "Unexpected O1 length $rc" }
        $text = $buffer.TrimEnd([char]0)
        if ($text.Length -ne 962 -or $text -match '[^\x00-\x7F]') { throw 'Non-ASCII or truncated O1' }
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($text)
        $records.Add(@{base64=[Convert]::ToBase64String($bytes);received_at=$received})
    }
    @{request_started_at=$started;records=@($records.ToArray())} | ConvertTo-Json -Depth 5 -Compress
} finally {
    if ($null -ne $jv) {
        if ($opened) { $null = $jv.JVClose() }
        $null = [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($jv)
    }
}

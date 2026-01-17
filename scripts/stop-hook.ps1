# WhatsApp-Me Stop Hook Script
# Reads input JSON, checks stop_hook_active, returns appropriate decision

$inputText = [Console]::In.ReadToEnd()

# Log input for debugging
$logFile = Join-Path $PSScriptRoot "stop-hook-debug.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logFile -Value "[$timestamp] Input received: $inputText"

try {
    $data = $inputText | ConvertFrom-Json
    $stopHookActive = $data.stop_hook_active
    
    Add-Content -Path $logFile -Value "[$timestamp] stop_hook_active = $stopHookActive"
    
    if ($stopHookActive -eq $true) {
        # Already triggered once, allow stopping by outputting empty JSON
        Add-Content -Path $logFile -Value "[$timestamp] Allowing stop (empty output)"
        Write-Output '{}'
        exit 0
    } else {
        # First time, block and ask to use WhatsApp
        Add-Content -Path $logFile -Value "[$timestamp] Blocking stop"
        Write-Output '{"decision": "block", "reason": "Use send_message with wait_for_reply=true to ask what the user wants next."}'
        exit 0
    }
} catch {
    Add-Content -Path $logFile -Value "[$timestamp] Error: $_"
    Write-Output '{}'
    exit 0
}

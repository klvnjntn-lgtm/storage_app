; Firewall rules so the other PCs can reach the main PC: the WareSys app
; (TCP 47331) and discovery (UDP 47333). Private and domain networks only,
; like the server install (release/install.ps1). Added on every install
; (harmless on PCs used as clients: nothing listens there) and removed on
; uninstall. The installer runs elevated (perMachine).
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="WareSys (TCP 47331)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="WareSys discovery (UDP 47333)"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="WareSys (TCP 47331)" dir=in action=allow protocol=TCP localport=47331 profile=private,domain'
  nsExec::Exec 'netsh advfirewall firewall add rule name="WareSys discovery (UDP 47333)" dir=in action=allow protocol=UDP localport=47333 profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="WareSys (TCP 47331)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="WareSys discovery (UDP 47333)"'
!macroend

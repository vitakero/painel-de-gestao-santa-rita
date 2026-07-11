' Mini-robo do PIX (faixa expressa): roda o pix.bat INVISIVEL a cada 1 minuto.
' O robo grandao do VR (robo-loop.vbs) continua separado, no ritmo dele.
' Guarda de instancia unica: se ja tem outro pix-loop rodando, avisa e sai.
Dim wmi, procs, p, n
n = 0
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='wscript.exe'")
For Each p In procs
  If Not IsNull(p.CommandLine) Then
    If InStr(LCase(p.CommandLine), "pix-loop.vbs") > 0 Then n = n + 1
  End If
Next
If n > 1 Then
  MsgBox "O mini-robo do PIX JA ESTA LIGADO. Nao precisa abrir de novo.", 48, "Pix Santa Rita"
  WScript.Quit
End If

Dim sh
Set sh = CreateObject("WScript.Shell")
Do
  sh.Run """C:\vr-robo\pix.bat""", 0, True  ' 0 = janela invisivel, True = espera terminar
  WScript.Sleep 8000                         ' dorme 8 segundos (quase instantaneo)
Loop

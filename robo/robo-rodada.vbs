' ============================================================================
' UMA RODADA DO ROBO, SEM JANELA - chamado pelo Agendador de Tarefas do Windows.
'
' A palavra ROBO-RODADA-VBS na linha abaixo e a senha de conferencia do download: sem ela o
' puxar-codigo recusa o arquivo e a loja fica com a versao velha, dizendo so
' "(invalido - mantendo o atual)" no meio de vinte linhas. Ja aconteceu em 21/08/2026.
' MARCADOR: ROBO-RODADA-VBS
'
' POR QUE ISTO E TAO CURTO. Ate 11/10/2026 quem mandava o robo trabalhar era um laco infinito
' (robo-loop.vbs) que morava SO na maquina da loja, sem copia em lugar nenhum. Laco infinito
' tem dois defeitos que ninguem ve: se ele morre - alguem fecha a janela, o Windows reinicia
' de madrugada, falta luz - ninguem o religa; e o proprio Agendador MATA tarefas que passam de
' 3 dias, entao ele morreria sozinho a cada 72 horas, sem motivo e sem aviso.
'
' Entao o laco deixou de existir: quem repete agora e o AGENDADOR DE TAREFAS, feito para isso,
' que sobrevive a reinicio, a falta de luz e a gente fechando janela. Este arquivo faz UMA
' rodada e sai. Se a anterior ainda estiver correndo, o Agendador nao abre outra (regra
' IgnoreNew, no XML do instalador): duas rodadas juntas mexeriam nos mesmos arquivos.
'
' O QUE ESTE ARQUIVO FAZ ALEM DE CHAMAR: guarda a saida e DEVOLVE o resultado.
' Na primeira versao ele chamava o robo.bat e ia embora sem olhar. Com isso o Agendador via
' "0x0 - sucesso" mesmo quando a rodada morria em :erro ou :pecas, as tres tentativas de
' RestartOnFailure nunca entravam, e todo o texto do robo.bat - inclusive a mensagem que
' explica o que faltou - desaparecia junto com a janela invisivel. O painel congelava e a
' tela do Agendador dizia que estava tudo bem.
' ============================================================================

Option Explicit

Const PASTA = "C:\vr-robo"

Dim sh, fso, inicio, codigo, saida, marca
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
inicio = Now
marca  = PASTA & "\output\robo-ultima-chamada.txt"
saida  = PASTA & "\output\robo-ultimo.txt"

' GARANTE A PASTA output. Sem ela o redirecionamento falha e a rodada morre sem dizer por que.
On Error Resume Next
If Not fso.FolderExists(PASTA & "\output") Then fso.CreateFolder(PASTA & "\output")
Escrever marca, "O Agendador do Windows chamou o robo em: " & inicio & vbCrLf & vbCrLf & _
  "Esta rodada ainda esta correndo (ou foi interrompida antes de terminar)."
On Error GoTo 0

' TRAVA DE RODADA - cinto e suspensorio.
' O Agendador ja promete nao abrir uma rodada por cima da outra (IgnoreNew), mas essa promessa
' vale para o wscript.exe que ELE lancou. Quando o limite de 40 minutos estoura, ele mata o
' wscript - e o cmd e o node que estavam embaixo podem sobreviver. A tarefa fica livre, a
' proxima rodada entra, e duas rodadas passam a mexer nos mesmos arquivos ao mesmo tempo.
' Esta trava nao depende do Agendador: e um arquivo com a hora de inicio. Se existir e for
' recente, esta rodada sai calada. Depois de 40 minutos a trava vence sozinha, para um
' travamento nao deixar o robo parado para sempre.
Dim trava, agoraMin
trava = PASTA & "\output\robo-rodando.txt"
On Error Resume Next
If fso.FileExists(trava) Then
  Dim arq, quando
  Set arq = fso.GetFile(trava)
  quando = arq.DateLastModified
  If Err.Number = 0 Then
    If DateDiff("n", quando, Now) < 40 Then
      Escrever marca, "Rodada pulada em " & Now & ": a anterior (de " & quando & ") ainda esta correndo." & vbCrLf & _
        "Isto e normal quando uma rodada demora. Se aparecer sempre, veja " & saida
      WScript.Quit 0
    End If
  End If
End If
Escrever trava, "Rodada em andamento desde " & Now
On Error GoTo 0

' A RODADA. Vai por "cmd /c" para poder guardar tudo o que o robo.bat escreve - e o
' robo-ultimo.txt e o unico lugar onde esse texto existe, porque a janela e invisivel.
' 0 = sem janela; True = espera terminar, e so esperando o Run devolve o codigo de saida.
codigo = sh.Run("cmd /c """"" & PASTA & "\robo.bat"" > """ & saida & """ 2>&1""", 0, True)

' O CARIMBO SO VALE DEPOIS DE TERMINAR. Antes ele era escrito na entrada, e com isso uma
' rodada que falhava a cada 5 minutos mantinha a hora sempre fresca: quem conferisse concluiria
' que estava tudo certo enquanto o painel envelhecia.
On Error Resume Next
Escrever marca, _
  "Rodada do robo" & vbCrLf & _
  "  comecou:  " & inicio & vbCrLf & _
  "  terminou: " & Now & vbCrLf & _
  "  resultado: " & codigo & "   (0 = deu certo; qualquer outro numero = falhou)" & vbCrLf & vbCrLf & _
  "O que o robo escreveu nesta rodada esta em: " & saida & vbCrLf & vbCrLf & _
  "COMO LER ISTO:" & vbCrLf & _
  "  - resultado 0 e hora de agora ha pouco: esta tudo certo." & vbCrLf & _
  "  - resultado diferente de 0: a rodada falhou; o motivo esta no arquivo acima." & vbCrLf & _
  "  - hora velha (mais de uns 10 minutos, com a loja aberta): a tarefa 'ROBO SANTA RITA'" & vbCrLf & _
  "    pode ter sido apagada do Agendador. Para repor, rode como administrador:" & vbCrLf & _
  "       " & PASTA & "\instalar-robo-automatico.bat"
On Error GoTo 0

' libera a trava: a proxima rodada pode entrar
On Error Resume Next
fso.DeleteFile trava, True
On Error GoTo 0

' DEVOLVE O RESULTADO AO AGENDADOR. E isto que faz a tela do Agendador contar a verdade e as
' tres tentativas de RestartOnFailure valerem alguma coisa.
WScript.Quit codigo

Sub Escrever(caminho, texto)
  Dim f
  Set f = fso.CreateTextFile(caminho, True)
  f.Write texto & vbCrLf
  f.Close
End Sub

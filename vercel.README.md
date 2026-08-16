# Por que existe o vercel.json

## O problema
GitHub Pages e Vercel servem o MESMO arquivo do MESMO repositório. Cada commit disparava
uma publicação no Vercel, e o plano gratuito permite 100 por dia. Num dia de muitos ajustes
o limite estourava e o domínio de produção congelava numa versão velha.

## A regra
O Vercel só publica quando a mensagem do commit tiver **[publicar]**. Todo o resto vai pro
GitHub normalmente — então o endereço de teste (vitakero.github.io) atualiza a cada ajuste,
e o domínio de produção só muda quando o dono mandar.

Quem marca `[publicar]`: o robô da loja (sempre, porque produção precisa de dado fresco) e
o Mac só quando roda com `SUBIR=1`.

## Duas armadilhas que já custaram caro

**1. Campo desconhecido derruba o deploy (09/08/2026).** O arquivo tinha um campo
`_comentario` com esta explicação dentro. O Vercel valida o `vercel.json` de forma estrita e
**recusa qualquer chave que não conheça** — o arquivo virava inválido e TODA publicação
falhava, com email de erro. O domínio ficou um dia inteiro parado por causa disso.
Por isso esta explicação mora aqui, num arquivo separado, e não dentro do JSON.

**2. Falha segura (08/08/2026).** A primeira versão usava `grep` na variável
`VERCEL_GIT_COMMIT_MESSAGE`. Se a variável não chega, o grep falha, a regra manda IGNORAR e
o site congela. Agora, mensagem vazia = PUBLICA. Errar publicando demais custa uma vaga do
limite; errar ignorando deixa a loja com o site velho.

## Regra do Vercel (não inverter)
`exit 1` = publica · `exit 0` = ignora

## Para desfazer
Apague o `vercel.json`. O Vercel volta a publicar a cada commit.


## O portal do fornecedor tem endereço próprio (16/08/2026)

`portalfornecedor.supermercadosantarita.com.br` e `painel.supermercadosantarita.com.br`
são o MESMO deploy, servindo dois públicos. O que separa é o bloco `rewrites`:
quando o endereço pedido é o do portal, a raiz `/` entrega o `agendar.html` em vez
do `index.html`.

Por que existe: mandar para o fornecedor um link com "painel" no meio soa como se
ele fosse entrar no sistema interno da loja. Alguns não clicam.

**`rewrites` e `has` são campos documentados do Vercel** — não confundir com o caso
de 09/08, em que o problema foi um campo INVENTADO (`_comentario`). O Vercel aceita
o que ele conhece e recusa o resto.

Se um dia o portal mudar de arquivo, é o `destination` que muda aqui.

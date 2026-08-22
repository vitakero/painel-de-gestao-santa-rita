# Design System de E-mails — Painel Santa Rita

Identidade visual OFICIAL de **todos** os e-mails do Painel Santa Rita (recuperação de senha, convites,
2FA, boletos, contratos, alertas, avisos financeiros, notificações, aprovações, relatórios).

**Regra de ouro:** entre um e-mail e outro, só mudam **4 coisas** — ícone principal, título,
texto e botão. Todo o resto (cabeçalho, card de segurança quando aplicável, link alternativo,
rodapé, cores, espaçamentos) permanece idêntico.

## Arquivos
- `base.html` — template-mestre com os marcadores `[[ICONE]] [[PREVIEW]] [[TITULO]] [[TEXTO]] [[ROTULO_BOTAO]] [[URL_BOTAO]]` (+ blocos opcionais marcados com comentários)
- `recuperar-senha.html` — variante pronta pro Supabase (Reset Password), com `{{ .ConfirmationURL }}`

## Tokens (paleta e tipografia)

| Token | Valor | Uso |
|---|---|---|
| Verde institucional | `#157a35` | linha do topo, botão, links de ação |
| Verde hover | `#116330` | hover do botão |
| Fundo da página | `#f4f5f7` | fora do cartão |
| Cartão | `#ffffff` + borda `#e7eaee` + raio `16px` | container principal (560px) |
| Título | `#0f172a` · 22px · 700 · -0.2px | H1 |
| Corpo | `#475569` · 15px · 1.65 | parágrafos |
| Observação | `#64748b` · 13px | card de segurança |
| Apagado | `#8a94a0` · 12px | legendas, rodapé |
| Superfície suave | `#f8fafc` + borda `#eceff3` + raio `12px` | cards internos |
| Ícone principal | 48×48 · fundo `#e9f4ed` · borda `#d8ecdf` · raio `12px` · emoji 22px | topo do conteúdo |
| Fonte | `'Inter', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial` | tudo |

## Componentes
1. **Linha institucional** — 3px verde no topo do cartão (única cor forte fixa).
2. **Cabeçalho** — símbolo do carrinho (52px, assets/simbolo-carrinho.png — NUNCA o logo com texto, evita redundância com o nome ao lado) à esquerda; "Painel Santa Rita" + "Gestão interna da loja" à direita; fio `#edf0f3` embaixo.
3. **Ícone principal** — badge 48px com emoji do assunto (🔒 senha, 📄 boleto, ✅ aprovação, ⚠️ alerta, 📊 relatório, ✉️ convite, 🔑 2FA).
4. **Título + texto** — curtos; leitura em <10s.
5. **Botão** — 50px de altura, raio 12px, verde, ícone + rótulo, sombra sutil; vira largura total no celular.
6. **Card de segurança** (para e-mails de acesso) — 🔒 + expiração, uso único, "ignore se não foi você".
7. **Link alternativo** — "copie e cole no navegador" + URL em monospace verde.
8. **Rodapé** — Supermercado Santa Rita · Painel Santa Rita · Caicó • RN · Acessar o painel · Contato · "e-mail automático, não responda".

## Compatibilidade
- Tabelas + estilos inline (Gmail/Outlook); media query só como melhoria progressiva.
- Dark mode: `prefers-color-scheme` + classes (`bg-page`, `bg-card`, `bg-soft`, `t-*`, `hairline`).
- Preheader oculto para o texto de pré-visualização.
- Logo transparente (funciona em claro e escuro).

## Variáveis Supabase por template
- Reset Password / Magic Link / Invite / Confirm signup → `{{ .ConfirmationURL }}`
- E-mails enviados pelo robô/Resend → URL própria.

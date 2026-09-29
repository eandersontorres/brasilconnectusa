# Pacote P0 da auditoria · o que foi aplicado em 28/09/2026

Complementa `docs/auditoria-plataforma-2026-09-28.md`.

## Banco (já aplicado em produção)

| Mudança | Arquivo |
|---|---|
| View `bc_onboarding_drip_candidates`, tabela `bc_onboarding_drip_log` e 6 funções fechadas para `anon`/`authenticated`/`PUBLIC`. Verificado: leitura anônima agora responde 401. | `supabase/fix_2026_09_28_seguranca.sql` |
| `platform_fee_pct` com default 0 e zerado em todos os negócios. Tabela `bc_email_optouts`. | `supabase/bc_fee_zero_e_email_optouts.sql` |

## Código

| Item | O que mudou |
|---|---|
| Crons | `drip`, `agenda/reminders` e `moderation` aceitam `Authorization: Bearer <CRON_SECRET>` (como o Vercel envia). `vercel.json` sem `?secret=__CRON__`. |
| Lembretes do AgendaPro | O cron não marca mais `reminder_24h_sent` sem enviar. Só registra o que enviaria, até o envio real existir. |
| Comissão | `api/restaurant/order.js`: 0% por padrão. Só cobra se o admin definir `platform_fee_pct > 0` no negócio. |
| `listing_plan` | `api/businesses/submit.js`: sempre `free`. O valor do body é ignorado. |
| Descadastro | `api/unsubscribe.js` + `api/_lib/unsubscribe.js`. Link real no rodapé dos e-mails de drip e onboarding, headers `List-Unsubscribe`, e os crons pulam quem pediu para sair. O link usa um id assinado, sem e-mail na URL, e pede confirmação. |
| Alertas de câmbio | Link "Cancelar alertas" funciona (antes era `id=UNSUBSCRIBE` literal). `DELETE /api/alerts` exige token assinado. |
| Páginas internas | `middleware.js`: `/admin/plano`, `/admin/roadmap` e `/admin/utm-builder` pedem senha (HTTP Basic, senha = `ADMIN_SECRET`). |
| Páginas de venda | Recursos que o código não entrega ficaram marcados como "em breve" ou saíram do texto: lembretes, SMS, reviews com selo, galeria, multi-profissional, relatórios, sem branding, estoque, modificadores, estorno "pelo botão no painel", chat no marketplace. |

## Pendente do P0 (depende de você)

1. **Endereço postal no rodapé dos e-mails** (CAN-SPAM). Informar o endereço.
2. **Leaked-password protection**: Supabase → Auth → Settings → ligar.
3. **Conferir os crons** em Vercel → Settings → Cron Jobs depois do deploy. `CRON_SECRET` precisa estar configurado no projeto.
4. **Remover os `DISABLE ROW LEVEL SECURITY`** dos SQL antigos do repo (lista no fim de `fix_2026_09_28_seguranca.sql`).

## Como testar

- `GET /admin/plano` sem senha → 401. Com usuário qualquer e a senha de admin → abre.
- `GET /api/unsubscribe?k=u&id=x&t=y` → 400 "Link inválido".
- Pedido de teste num restaurante → `platform_fee_cents = 0` em `bc_orders`.

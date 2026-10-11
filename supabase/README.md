# Banco de dados (Supabase)

Projeto: `ggwppcbdnemjuddnzbdw`.

## Como o site acessa o banco

O site e o app **nunca** leem tabelas direto do navegador. Tudo passa pelas rotas em `api/`,
que usam a chave `service_role`. Por isso a regra é:

- **RLS ligado em todas as tabelas**, sem policy para `anon` e `authenticated`.
- Views e funções com `GRANT` só para `service_role`.
- Nunca usar `DISABLE ROW LEVEL SECURITY`. Os arquivos antigos que faziam isso foram corrigidos
  em 29/09/2026, e o banco em produção foi corrigido pela migration `fix_2026_09_28_seguranca`.

## Arquivos desta pasta

Os `.sql` daqui são o histórico do que foi rodado à mão no SQL Editor ou aplicado como migration.
Todos são idempotentes (`IF NOT EXISTS`, `CREATE OR REPLACE`).

Migrations aplicadas em produção a partir de 28/09/2026, em ordem:

| Migration | Arquivo |
|---|---|
| `fix_2026_09_28_seguranca` | `fix_2026_09_28_seguranca.sql` |
| `platform_fee_zero_and_email_optouts` | `bc_fee_zero_e_email_optouts.sql` |
| `bc_businesses_public_midia` | `bc_businesses_public_midia.sql` |
| `agendapro_operavel` | `ag_agendapro_operavel.sql` |
| `bc_listing_subscriptions` | `bc_listing_subscriptions.sql` |
| `bc_geocode_hits_fn` | `bc_geocode_hits_fn.sql` |
| `bc_admin_audit` | `bc_admin_audit.sql` |
| `bc_direct_messages` | `bc_direct_messages.sql` |
| `bc_store_schema` (a aplicar) | `bc_store_schema.sql` |

## Regra para mudanças novas

1. Escrever o SQL num arquivo novo aqui, idempotente, com a data no cabeçalho.
2. Aplicar como migration com nome igual ao do arquivo.
3. Acrescentar a linha na tabela acima.
4. Rodar o Security Advisor do Supabase depois de criar tabela, view ou função.

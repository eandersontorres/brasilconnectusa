-- ════════════════════════════════════════════════════════════════════════
-- Topicos de notificacao push
-- Permite ao user escolher o que quer receber.
-- Topicos validos: 'orders' (pedidos), 'community' (mensagens), 'cambio',
--                  'events' (eventos perto), 'bolao' (palpites/resultados),
--                  'restaurant_status' (cliente acompanha pedido)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE bc_push_subscriptions
  ADD COLUMN IF NOT EXISTS topics TEXT[] DEFAULT ARRAY['orders','community','events','bolao'];

CREATE INDEX IF NOT EXISTS idx_push_topics ON bc_push_subscriptions USING GIN(topics)
  WHERE active = true;

-- Verificacao
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'bc_push_subscriptions' AND column_name = 'topics';

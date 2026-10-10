// Aviso do plano no topo das telas principais: teste grátis acabando, pagamento
// pendente ou plano inativo. Some quando está tudo em dia.
import { useApp } from '../lib/session'
import { openPlans } from '../lib/gate'
import { EXTERNAL_PURCHASE } from '../lib/config'
import { Banner } from './ui'

export default function PlanBanner() {
  const { ent, provider } = useApp()
  if (!provider) return null
  if (ent.past_due) {
    return <Banner tone="red" icon="card-outline" text={EXTERNAL_PURCHASE ? 'Não conseguimos cobrar seu cartão. Atualize o pagamento pra não perder os recursos.' : 'Não conseguimos processar a cobrança do seu plano.'} action="Detalhes" onPress={() => openPlans()} />
  }
  if (ent.tier === 'none') {
    return <Banner tone="red" icon="lock-closed-outline" text="Seu plano não está ativo: sua página não aceita agendamentos." action={EXTERNAL_PURCHASE ? 'Assinar' : 'Detalhes'} onPress={() => openPlans()} />
  }
  if (ent.trial && !provider.has_subscription && ent.trial_days_left <= 7) {
    const d = ent.trial_days_left
    return <Banner tone="gold" icon="sparkles-outline" text={d <= 1 ? 'Seu teste grátis acaba hoje.' : `Faltam ${d} dias do seu teste grátis.`} action={EXTERNAL_PURCHASE ? 'Ver planos' : 'Detalhes'} onPress={() => openPlans()} />
  }
  return null
}

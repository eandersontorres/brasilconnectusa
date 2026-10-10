// Perfil e página pública: fotos (perfil, capa, galeria), o que a cliente vê e o
// link /agenda/seu-nome. Fotos salvam na hora; os textos, no botão Salvar (o
// POST /api/agenda/provider é parcial: só manda o que mudou).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, router, useNavigation } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as WebBrowser from 'expo-web-browser'
import * as Haptics from 'expo-haptics'
import { api, post } from '../lib/api'
import { useApp } from '../lib/session'
import { ensureFeature, featureInfo, showError } from '../lib/gate'
import { choose, confirm, notify } from '../lib/dialog'
import { API_BASE, PUBLIC_PAGE } from '../lib/config'
import { phoneDigits } from '../lib/format'
import { colors, radius, spacing, type } from '../lib/theme'
import { Avatar, Badge, Banner, Button, Card, ErrorBox, H2, Input, Loading, Muted, Screen, Section, Small } from '../components/ui'
import { LockedCard } from '../components/Locked'

const MAX_GALLERY = 10
const MAX_BIO = 2000
const MAX_UPLOAD = 480 * 1024                       // servidor aceita até 500 KB
const SIZES = [[1200, 0.7], [1000, 0.6], [800, 0.5]] // tenta menor se passar do limite
const HOST = API_BASE.replace(/^https?:\/\//, '')

const isWeb = Platform.OS === 'web'

// ── Fotos ────────────────────────────────────────────────────────────────
/** Redimensiona (lado maior ~1200px), JPEG e base64. */
async function prepareImage(asset) {
  const w = asset.width || 0
  const h = asset.height || 0
  for (const [max, q] of SIZES) {
    const ctx = ImageManipulator.manipulate(asset.uri)
    if (!w || !h) ctx.resize({ width: max })
    else if (Math.max(w, h) > max) ctx.resize(w >= h ? { width: max } : { height: max })
    const img = await ctx.renderAsync()
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: q, base64: true })
    if (out.base64 && out.base64.length * 0.75 <= MAX_UPLOAD) return out.base64
  }
  throw new Error('A foto ficou grande demais. Tente outra.')
}

async function uploadImage(asset) {
  const b64 = await prepareImage(asset)
  const r = await post('/api/upload', { file_data: `data:image/jpeg;base64,${b64}`, folder: 'providers' })
  if (!r?.url) throw new Error('Não deu pra enviar a foto. Tente de novo.')
  return r.url
}

/** Câmera ou galeria do celular. No preview web, só arquivo. */
async function askSource(title, { allowRemove = false } = {}) {
  if (isWeb && !allowRemove) return 'library'
  const options = []
  if (!isWeb) options.push({ label: 'Tirar foto', value: 'camera' })
  options.push({ label: isWeb ? 'Escolher arquivo' : 'Escolher da galeria', value: 'library' })
  if (allowRemove) options.push({ label: 'Remover foto', value: 'remove', destructive: true })
  return choose(title, options)
}

async function getImages(source, { aspect, multiple = false, limit = 1 } = {}) {
  const editing = !multiple && !!aspect
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      notify('Sem acesso à câmera', 'Libere a câmera para o AgendaPro nos Ajustes do celular.')
      return []
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: editing, aspect, quality: 1 })
    return res.canceled ? [] : (res.assets || [])
  }
  if (!isWeb) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      notify('Sem acesso às fotos', 'Libere o acesso às fotos para o AgendaPro nos Ajustes do celular.')
      return []
    }
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: editing,
    aspect,
    quality: 1,
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? limit : 1,
  })
  return res.canceled ? [] : (res.assets || [])
}

// ── Formulário ───────────────────────────────────────────────────────────
const TEXT_FIELDS = ['name', 'specialty', 'bio', 'city', 'state', 'whatsapp', 'instagram', 'video_url', 'slug']

const stripAt = (v) => String(v || '').trim().replace(/^@+/, '')
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '')

function formOf(p) {
  return {
    name: p?.name || '',
    specialty: p?.specialty || '',
    bio: p?.bio || '',
    city: p?.city || '',
    state: p?.state || '',
    whatsapp: p?.whatsapp || '',
    instagram: p?.instagram ? '@' + stripAt(p.instagram) : '',
    video_url: p?.video_url || '',
    slug: p?.slug || '',
  }
}

/** Valor normalizado pra comparar e pra mandar ao servidor. */
function norm(key, v) {
  const s = String(v ?? '').trim()
  if (key === 'state') return s.toUpperCase()
  if (key === 'instagram') return stripAt(s)
  if (key === 'slug') return slugify(s)
  return s
}

function validate(f) {
  const e = {}
  if (!f.name.trim()) e.name = 'Escreva o nome que aparece pras clientes.'
  if (f.state.trim() && !/^[A-Za-z]{2}$/.test(f.state.trim())) e.state = 'Sigla de 2 letras (ex.: MA)'
  if (f.whatsapp.trim() && phoneDigits(f.whatsapp).length < 11) e.whatsapp = 'Número incompleto. Coloque com o código de área.'
  if (f.instagram.trim() && !/^[A-Za-z0-9._]{1,30}$/.test(stripAt(f.instagram).replace(/^.*instagram\.com\//i, '').replace(/\/+$/, ''))) {
    e.instagram = 'Use só o @ do perfil (ex.: @anahair)'
  }
  if (f.video_url.trim() && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(f.video_url.trim())) {
    e.video_url = 'Cole o link do vídeo (YouTube, Instagram, TikTok…)'
  }
  if (slugify(f.slug).length < 3) e.slug = 'O link precisa ter pelo menos 3 letras ou números.'
  return e
}

// ── Tela ─────────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const app = useApp()
  const { setProvider } = app
  const navigation = useNavigation()

  const [profile, setProfile] = useState(null)     // como está salvo no servidor
  const [form, setForm] = useState(formOf(null))
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [busyPhoto, setBusyPhoto] = useState(null)  // 'avatar_url' | 'cover_url'
  const [galleryBusy, setGalleryBusy] = useState(null) // { done, total }
  const [viewer, setViewer] = useState(null)        // url da foto aberta

  const base = useMemo(() => formOf(profile), [profile])
  const changed = useMemo(() => TEXT_FIELDS.filter((k) => norm(k, form[k]) !== norm(k, base[k])), [form, base])
  const dirty = !!profile && changed.length > 0

  // Refs pro aviso de "sair sem salvar"
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  dirtyRef.current = dirty
  savingRef.current = saving

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const r = await api('/api/agenda/provider?mine=1')
      setProfile(r.provider)
      if (!dirtyRef.current) setForm(formOf(r.provider))
    } catch (e) {
      setLoadError(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || savingRef.current) return
      e.preventDefault()
      confirm('Sair sem salvar?', 'As mudanças nos textos do perfil vão se perder.', { ok: 'Sair sem salvar', cancel: 'Continuar editando', destructive: true })
        .then((ok) => { if (ok) navigation.dispatch(e.data.action) })
    })
    return unsub
  }, [navigation])

  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(0), 2500)
    return () => clearTimeout(t)
  }, [savedAt])

  const set = (key) => (v) => {
    setForm((f) => ({ ...f, [key]: v }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }))
  }

  /** Salva só as chaves do patch e atualiza perfil + sessão (sem mexer no que está sendo digitado). */
  async function savePatch(patch) {
    const r = await post('/api/agenda/provider', patch)
    setProfile(r.provider)
    setProvider(r.provider)
    return r.provider
  }

  async function save() {
    const e = validate(form)
    setErrors(e)
    if (Object.keys(e).some((k) => e[k])) {
      notify('Confira os campos', 'Tem informação faltando ou com erro no formulário.')
      return
    }
    const patch = {}
    for (const k of changed) patch[k] = norm(k, form[k]) || null

    if (patch.slug) {
      const ok = await confirm(
        'Trocar o link da sua página?',
        `O novo link será ${HOST}/agenda/${patch.slug}.\n\nO link antigo para de funcionar: QR codes impressos e links já enviados vão parar de abrir sua página.`,
        { ok: 'Trocar link', cancel: 'Manter o atual' },
      )
      if (!ok) return
    }

    setSaving(true)
    try {
      const p = await savePatch(patch)
      setForm(formOf(p))
      setSavedAt(Date.now())
      if (!isWeb) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (err) {
      if (err?.code === 'slug_taken') setErrors((x) => ({ ...x, slug: err.message }))
      else showError(err, 'Não deu pra salvar')
    } finally {
      setSaving(false)
    }
  }

  async function changePhoto(key) {
    const isAvatar = key === 'avatar_url'
    const current = profile?.[key]
    const source = await askSource(isAvatar ? 'Foto de perfil' : 'Foto de capa', { allowRemove: !!current })
    if (!source) return
    if (source === 'remove') {
      if (!(await confirm('Remover a foto?', isAvatar ? 'Sua página volta a mostrar as iniciais do seu nome.' : 'A capa volta pra cor verde da página.', { ok: 'Remover', destructive: true }))) return
      setBusyPhoto(key)
      try { await savePatch({ [key]: null }) } catch (e) { showError(e, 'Não deu pra remover a foto') } finally { setBusyPhoto(null) }
      return
    }
    try {
      const assets = await getImages(source, { aspect: isAvatar ? [1, 1] : [16, 9] })
      if (!assets.length) return
      setBusyPhoto(key)
      const url = await uploadImage(assets[0])
      await savePatch({ [key]: url })
    } catch (e) {
      showError(e, 'Não deu pra trocar a foto')
    } finally {
      setBusyPhoto(null)
    }
  }

  const gallery = Array.isArray(profile?.gallery_urls) ? profile.gallery_urls : []
  const canGallery = app.can('gallery')

  async function addGalleryPhotos() {
    if (!(await ensureFeature(app, 'gallery'))) return
    const room = MAX_GALLERY - gallery.length
    if (room <= 0) {
      notify('Galeria cheia', `Você já tem ${MAX_GALLERY} fotos. Remova uma pra colocar outra.`)
      return
    }
    const source = await askSource('Foto do seu trabalho')
    if (!source) return
    let assets = []
    try {
      assets = (await getImages(source, { multiple: source === 'library', limit: room })).slice(0, room)
    } catch (e) {
      showError(e, 'Não deu pra abrir as fotos')
      return
    }
    if (!assets.length) return

    setGalleryBusy({ done: 0, total: assets.length })
    const urls = []
    let failure = null
    for (const a of assets) {
      try {
        urls.push(await uploadImage(a))
        setGalleryBusy({ done: urls.length, total: assets.length })
      } catch (e) {
        failure = e
        break
      }
    }
    try {
      if (urls.length) await savePatch({ gallery_urls: [...gallery, ...urls] })
    } catch (e) {
      failure = e
    }
    setGalleryBusy(null)
    if (failure) showError(failure, urls.length ? `Só ${urls.length} foto(s) entraram` : 'Não deu pra enviar a foto')
  }

  async function galleryPhotoMenu(url, index) {
    const options = [{ label: 'Ver foto', value: 'view' }]
    if (index > 0 && canGallery) options.push({ label: 'Mostrar primeiro', value: 'first' })
    options.push({ label: 'Remover da galeria', value: 'remove', destructive: true })
    const act = await choose('Foto da galeria', options)
    if (!act) return
    if (act === 'view') { setViewer(url); return }
    const next = act === 'first'
      ? [url, ...gallery.filter((u) => u !== url)]
      : gallery.filter((u) => u !== url)
    if (act === 'remove' && !(await confirm('Remover a foto?', 'Ela sai da sua página pública.', { ok: 'Remover', destructive: true }))) return
    setGalleryBusy({ done: 0, total: 0 })
    try { await savePatch({ gallery_urls: next }) } catch (e) { showError(e) } finally { setGalleryBusy(null) }
  }

  async function openPage() {
    const slug = profile?.slug
    if (!slug) return
    const url = PUBLIC_PAGE(slug)
    if (isWeb) { window.open(url, '_blank'); return }
    try { await WebBrowser.openBrowserAsync(url, { controlsColor: colors.green }) } catch (_) {}
  }

  // ── Estados ──
  if (loading && !profile) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Perfil' }} />
        <Loading text="Carregando seu perfil…" />
      </Screen>
    )
  }
  if (!profile) {
    return (
      <Screen onRefresh={() => { setRefreshing(true); load() }} refreshing={refreshing}>
        <Stack.Screen options={{ title: 'Perfil' }} />
        <ErrorBox error={loadError || 'Não deu pra carregar seu perfil.'} onRetry={() => { setLoading(true); load() }} />
      </Screen>
    )
  }

  const checks = [
    { ok: !!profile.avatar_url, label: 'Foto de perfil' },
    { ok: !!profile.cover_url, label: 'Foto de capa' },
    { ok: String(profile.bio || '').trim().length >= 40, label: 'Bio contando o que você faz' },
    { ok: !!profile.city, label: 'Cidade' },
    { ok: !!profile.whatsapp, label: 'WhatsApp' },
    { ok: !!profile.instagram, label: 'Instagram' },
    ...(canGallery ? [{ ok: gallery.length >= 3, label: '3 fotos do seu trabalho' }] : []),
  ]
  const done = checks.filter((c) => c.ok).length
  const pct = Math.round((done / checks.length) * 100)
  const slugPreview = slugify(form.slug) || '…'
  const galleryInfo = featureInfo(app.ent, 'gallery')

  const footer = dirty ? (
    <View style={{ gap: spacing.sm }}>
      <Muted style={{ textAlign: 'center' }}>{changed.length === 1 ? '1 mudança sem salvar' : `${changed.length} mudanças sem salvar`}</Muted>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title="Desfazer" variant="secondary" onPress={() => { setForm(base); setErrors({}) }} style={{ flex: 1 }} disabled={saving} />
        <Button title="Salvar" icon="checkmark" onPress={save} loading={saving} style={{ flex: 2 }} />
      </View>
    </View>
  ) : null

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title: 'Perfil' }} />
      <Screen onRefresh={() => { setRefreshing(true); load() }} refreshing={refreshing} footer={footer}>
        {savedAt ? <Banner text="Perfil salvo. Sua página já está atualizada." tone="green" icon="checkmark-circle" /> : null}

        {/* Capa + foto de perfil */}
        <Pressable onPress={() => changePhoto('cover_url')} accessibilityRole="button" accessibilityLabel="Trocar foto de capa" style={s.cover}>
          {profile.cover_url ? <Image source={{ uri: profile.cover_url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          {busyPhoto === 'cover_url' ? <View style={s.busy}><ActivityIndicator color={colors.white} /></View> : null}
          <View style={s.coverBtn}>
            <Ionicons name="camera" size={14} color={colors.white} />
            <Text style={s.coverBtnText}>{profile.cover_url ? 'Trocar capa' : 'Colocar capa'}</Text>
          </View>
        </Pressable>

        {/* box-none: a parte vazia da linha não rouba o toque do botão da capa */}
        <View style={s.headRow} pointerEvents="box-none">
          <Pressable onPress={() => changePhoto('avatar_url')} accessibilityRole="button" accessibilityLabel="Trocar foto de perfil" style={s.avatarWrap}>
            <Avatar name={profile.name} uri={profile.avatar_url} size={88} />
            {busyPhoto === 'avatar_url' ? <View style={[s.busy, { borderRadius: 44 }]}><ActivityIndicator color={colors.white} /></View> : null}
            <View style={s.avatarBadge}><Ionicons name="camera" size={14} color={colors.white} /></View>
          </Pressable>
          <View style={{ flex: 1, paddingTop: 50 }} pointerEvents="box-none">
            <H2 numberOfLines={2}>{profile.name}</H2>
            {profile.specialty ? <Muted numberOfLines={1}>{profile.specialty}</Muted> : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
          <Button title="Ver minha página" icon="open-outline" variant="secondary" small onPress={openPage} style={{ flex: 1 }} />
          <Button title="Link e QR code" icon="qr-code-outline" variant="secondary" small onPress={() => router.push('/share')} style={{ flex: 1 }} />
        </View>
        {dirty ? <Muted style={{ marginTop: 6, textAlign: 'center' }}>Salve pra ver as mudanças na página.</Muted> : null}

        {/* Perfil completo vende mais */}
        {pct < 100 ? (
          <Card style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[type.h3, { flex: 1 }]}>Seu perfil está {pct}% completo</Text>
              <Badge text={`${done}/${checks.length}`} tone="gold" />
            </View>
            <View style={s.progress}><View style={[s.progressFill, { width: `${pct}%` }]} /></View>
            <Muted>Perfil com foto, bio e trabalhos passa mais confiança e recebe mais agendamentos. Falta:</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
              {checks.filter((c) => !c.ok).map((c) => <Badge key={c.label} text={c.label} tone="gray" icon="ellipse-outline" />)}
            </View>
          </Card>
        ) : null}

        <Section title="Sobre você">
          <Input label="Nome do negócio ou seu nome" value={form.name} onChangeText={set('name')} error={errors.name}
            placeholder="Ex.: Ana Torres Hair" autoCapitalize="words" maxLength={120} />
          <Input label="O que você faz" value={form.specialty} onChangeText={set('specialty')}
            placeholder="Ex.: Cabeleireira, Manicure, House cleaning" maxLength={120} />
          <Input label="Bio" value={form.bio} onChangeText={set('bio')} multiline maxLength={MAX_BIO}
            placeholder="Conte sua experiência, especialidades, se atende em casa, idiomas…"
            hint={`${form.bio.length}/${MAX_BIO} · Aparece embaixo do seu nome na página.`} inputStyle={{ minHeight: 120 }} />
        </Section>

        <Section title="Onde e como falar com você">
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Input label="Cidade" value={form.city} onChangeText={set('city')} placeholder="Ex.: Boston" style={{ flex: 2 }} autoCapitalize="words" maxLength={80} />
            <Input label="Estado" value={form.state} onChangeText={(v) => set('state')(v.toUpperCase().replace(/[^A-Z]/gi, '').slice(0, 2))}
              error={errors.state} placeholder="MA" style={{ flex: 1 }} autoCapitalize="characters" maxLength={2} />
          </View>
          <Input label="WhatsApp" value={form.whatsapp} onChangeText={set('whatsapp')} error={errors.whatsapp}
            placeholder="(617) 555-0101" keyboardType="phone-pad" maxLength={30}
            hint="Aparece na página pra cliente tirar dúvida." />
          <Input label="Instagram" value={form.instagram} onChangeText={set('instagram')} error={errors.instagram}
            placeholder="@seuperfil" autoCapitalize="none" autoCorrect={false} maxLength={60} />
        </Section>

        <Section title="Vídeo de apresentação">
          <Input label="Link do vídeo" value={form.video_url} onChangeText={set('video_url')} error={errors.video_url}
            placeholder="https://youtube.com/…" autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={500}
            hint="YouTube e Vimeo tocam direto na página. Outros links viram um botão." />
        </Section>

        <Section title="Galeria de fotos" right={!canGallery ? <Badge text={galleryInfo.minName} tone="gold" icon="lock-closed" /> : <Small>{gallery.length}/{MAX_GALLERY}</Small>}>
          {canGallery ? (
            <Card>
              <Muted style={{ marginBottom: spacing.md }}>Fotos do seu trabalho (antes e depois, resultados). Toque numa foto pra ver, mover ou remover.</Muted>
              <View style={s.grid}>
                {gallery.map((url, i) => (
                  <Pressable key={url} onPress={() => galleryPhotoMenu(url, i)} style={s.thumb} accessibilityLabel={`Foto ${i + 1} da galeria`}>
                    <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    {i === 0 ? <View style={s.firstTag}><Text style={s.firstTagText}>1ª</Text></View> : null}
                  </Pressable>
                ))}
                {gallery.length < MAX_GALLERY ? (
                  <Pressable onPress={galleryBusy ? undefined : addGalleryPhotos} style={[s.thumb, s.addTile]} accessibilityRole="button" accessibilityLabel="Adicionar fotos">
                    {galleryBusy ? (
                      <>
                        <ActivityIndicator color={colors.green} />
                        {galleryBusy.total ? <Small style={{ marginTop: 4 }}>{galleryBusy.done}/{galleryBusy.total}</Small> : null}
                      </>
                    ) : (
                      <>
                        <Ionicons name="add" size={26} color={colors.green} />
                        <Small style={{ color: colors.green, fontWeight: '600' }}>Adicionar</Small>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>
            </Card>
          ) : (
            <>
              <LockedCard feature="gallery" />
              {gallery.length ? (
                <Muted style={{ marginTop: spacing.sm, textAlign: 'center' }}>
                  Suas {gallery.length} foto(s) continuam guardadas e voltam pra página quando o plano liberar.
                </Muted>
              ) : null}
            </>
          )}
        </Section>

        <Section title="Link da sua página">
          <Input label="Seu link" value={form.slug} onChangeText={set('slug')} error={errors.slug}
            autoCapitalize="none" autoCorrect={false} maxLength={60}
            hint={`${HOST}/agenda/${slugPreview}`} />
          <Muted>Use um link curto e fácil de falar, como o nome do seu negócio. Trocar o link desativa o anterior.</Muted>
        </Section>
      </Screen>

      {/* Foto da galeria em tela cheia */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={s.viewer} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={s.viewerImg} resizeMode="contain" /> : null}
          <View style={s.viewerClose}><Ionicons name="close" size={26} color={colors.white} /></View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  cover: { aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.green, justifyContent: 'flex-end', alignItems: 'flex-end' },
  coverBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, margin: spacing.sm },
  coverBtnText: { color: colors.white, fontSize: 13, fontWeight: '600' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: -44, paddingHorizontal: spacing.md },
  avatarWrap: { borderRadius: 48, borderWidth: 4, borderColor: colors.paper, backgroundColor: colors.paper },
  avatarBadge: { position: 'absolute', right: 0, bottom: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.paper },
  progress: { height: 8, borderRadius: 4, backgroundColor: colors.paperSoft, marginVertical: spacing.md, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.gold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: '31%', aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.paperSoft },
  addTile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.green, backgroundColor: colors.greenSoft },
  firstTag: { position: 'absolute', left: 6, top: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  firstTagText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 56, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
})

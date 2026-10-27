import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import gsap from 'gsap'
import { BlanketRoll, BookStack, ClothesStack, FoodPack, Heart, House, Island, PALETTE, PathRibbon, Person, SceneLights, ToyBlocks, Tree, type Pose, BlobShadow } from './primitives'

import { ITEM_RECIPIENT, type ItemKind, type StoryPhase } from './story'

const ITEM_NODE: Record<ItemKind, JSX.Element> = {
  book: <BookStack scale={0.8} />,
  blanket: <BlanketRoll scale={0.9} />,
  food: <FoodPack scale={0.85} />,
  clothes: <ClothesStack scale={0.8} />,
  toy: <ToyBlocks scale={0.9} />,
}

interface Anim {
  approach: number
  lift: number
  journey: number
  handoff: number
  cheer: number
}

const START = new THREE.Vector3(-4.2, 0, 2.6)
const PEDESTAL = new THREE.Vector3(-2.6, 0, 2.2)
const RECIPIENT = new THREE.Vector3(2.75, 0, -0.75)

function Story({ item, playToken, onPhase, still, waveToken }: { item: ItemKind; playToken: number; onPhase: (p: StoryPhase) => void; still?: boolean; waveToken: number }) {
  const anim = useRef<Anim>({ approach: 0, lift: 0, journey: 0, handoff: 0, cheer: 0 })
  const courier = useRef<THREE.Group | null>(null)
  const courierPose = useRef<Pose>('idle')
  const recipientPose = useRef<Pose>('idle')
  const hand = useRef<THREE.Group>(null)
  const recvHand = useRef<THREE.Group>(null)
  const itemRef = useRef<THREE.Group>(null)
  const hearts = useRef<THREE.Group>(null)
  const waveUntil = useRef(0)
  const { camera, clock } = useThree()
  const curve = useMemo(() => new THREE.CatmullRomCurve3([PEDESTAL.clone().add(new THREE.Vector3(0.55, 0, 0)), new THREE.Vector3(-0.8, 0, 1.6), new THREE.Vector3(1.1, 0, 0.9), new THREE.Vector3(2.15, 0, -0.1)]), [])
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), look: new THREE.Vector3(0, 1, 1), camT: new THREE.Vector3() }), [])
  const recipient = ITEM_RECIPIENT[item]

  // reset when the item changes
  useEffect(() => {
    Object.assign(anim.current, { approach: 0, lift: 0, journey: 0, handoff: 0, cheer: 0 })
    onPhase('ready')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])

  useEffect(() => {
    if (!playToken) return
    const a = anim.current
    Object.assign(a, { approach: 0, lift: 0, journey: 0, handoff: 0, cheer: 0 })
    const k = still ? 0.35 : 1
    const tl = gsap.timeline({ onComplete: () => onPhase('done') })
    tl.call(() => onPhase('approach'))
      .to(a, { approach: 1, duration: 1.1 * k, ease: 'power1.inOut' })
      .call(() => onPhase('lift'))
      .to(a, { lift: 1, duration: 0.8 * k, ease: 'back.out(1.6)' })
      .call(() => onPhase('journey'))
      .to(a, { journey: 1, duration: 4.4 * k, ease: 'power1.inOut' })
      .call(() => onPhase('handoff'))
      .to(a, { handoff: 1, duration: 1.1 * k, ease: 'power2.inOut' })
      .call(() => onPhase('celebrate'))
      .to(a, { cheer: 1, duration: 2.2 * k, ease: 'none' })
    return () => void tl.kill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playToken])

  useEffect(() => {
    if (waveToken) waveUntil.current = clock.elapsedTime + 1.6
  }, [waveToken, clock])

  useFrame((_, dt) => {
    const a = anim.current
    const c = courier.current
    if (!c) return
    // courier position
    if (a.journey > 0) {
      curve.getPointAt(Math.min(a.journey, 1), tmp.a)
      c.position.copy(tmp.a)
      const tan = curve.getTangentAt(Math.min(a.journey, 0.999))
      c.rotation.y = THREE.MathUtils.damp(c.rotation.y, Math.atan2(tan.x, tan.z), 8, dt)
    } else {
      c.position.lerpVectors(START, tmp.b.copy(PEDESTAL).setX(PEDESTAL.x - 0.15), a.approach)
      c.rotation.y = THREE.MathUtils.damp(c.rotation.y, a.approach > 0 && a.approach < 1 ? Math.PI / 2 - 0.2 : a.lift > 0 ? Math.PI / 2 : 0.5, 6, dt)
    }
    if (a.handoff > 0) c.rotation.y = THREE.MathUtils.damp(c.rotation.y, Math.atan2(RECIPIENT.x - c.position.x, RECIPIENT.z - c.position.z), 6, dt)

    // poses
    const walking = (a.approach > 0 && a.approach < 1) || (a.journey > 0 && a.journey < 1)
    const carrying = a.lift > 0.5 && a.handoff < 0.6
    if (a.cheer > 0 || clock.elapsedTime < waveUntil.current) courierPose.current = 'wave'
    else if (a.handoff > 0 && a.handoff < 1) courierPose.current = 'give'
    else if (walking) courierPose.current = carrying ? 'carryWalk' : 'walk'
    else courierPose.current = carrying ? 'carry' : 'idle'
    recipientPose.current = a.cheer > 0 ? 'cheer' : a.handoff > 0.2 ? 'receive' : recipient === 'elder' ? 'cane' : 'wave'

    // item position: pedestal → courier hands → recipient hands
    const it = itemRef.current
    if (it && hand.current && recvHand.current) {
      const ped = tmp.b.copy(PEDESTAL).setY(0.98)
      hand.current.getWorldPosition(tmp.a)
      if (a.lift < 1) it.position.lerpVectors(ped, tmp.a, a.lift)
      else if (a.handoff <= 0) it.position.copy(tmp.a)
      else {
        const from = tmp.a.clone()
        recvHand.current.getWorldPosition(tmp.b)
        it.position.lerpVectors(from, tmp.b, a.handoff)
        if (a.cheer > 0) it.position.copy(tmp.b)
      }
      it.rotation.y = a.lift < 1 && !still ? clock.elapsedTime * 0.6 : THREE.MathUtils.damp(it.rotation.y, c.rotation.y, 6, dt)
      const pulse = a.lift === 0 && !still ? 1 + Math.sin(clock.elapsedTime * 3) * 0.04 : 1
      it.scale.setScalar(pulse * (a.cheer > 0 ? 0.85 : 1))
    }

    // hearts
    if (hearts.current) {
      hearts.current.visible = a.cheer > 0
      hearts.current.children.forEach((h, i) => {
        const p = (a.cheer * 1.4 + i * 0.13) % 1
        h.position.set(RECIPIENT.x + Math.sin(i * 2.3) * 0.7, 1.6 + p * 2.2, RECIPIENT.z + Math.cos(i * 1.7) * 0.5)
        h.scale.setScalar(Math.sin(p * Math.PI) * (0.5 + (i % 3) * 0.2))
        h.rotation.y = clock.elapsedTime * 2 + i
      })
    }

    // camera
    const following = a.journey > 0 && a.cheer === 0
    if (following) tmp.camT.set(c.position.x + 1.4, 3.8, c.position.z + 8.2)
    else if (a.handoff > 0 || a.cheer > 0) tmp.camT.set(1.0, 3.4, 7.6)
    else tmp.camT.set(-0.4, 4.4, 11.5)
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tmp.camT.x, 2.2, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, tmp.camT.y, 2.2, dt)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, tmp.camT.z, 2.2, dt)
    const lookTarget = following ? tmp.a.set(c.position.x, 1, c.position.z) : a.handoff > 0 || a.cheer > 0 ? tmp.a.set(2.1, 1.1, -0.5) : tmp.a.set(-0.6, 0.8, 0.6)
    tmp.look.lerp(lookTarget, 1 - Math.exp(-3 * dt))
    camera.lookAt(tmp.look)
  })

  return (
    <>
      <Island radius={6} still={still} />
      <PathRibbon curve={curve} width={0.6} />
      <House position={[3.4, 0, -2.3]} rotationY={-0.5} />
      <Tree position={[-4.6, 0, -1]} scale={1.15} still={still} />
      <Tree position={[0.3, 0, -3.4]} scale={1.3} phase={1.2} still={still} />
      <Tree position={[4.8, 0, 0.9]} scale={0.95} phase={2.4} still={still} />
      <Tree position={[-1.8, 0, -2.6]} scale={0.8} phase={0.6} still={still} />

      {/* pedestal */}
      <group position={[PEDESTAL.x, 0, PEDESTAL.z]}>
        <BlobShadow size={1.2} />
        <RoundedBox args={[0.8, 0.6, 0.8]} radius={0.08} position={[0, 0.3, 0]}>
          <meshStandardMaterial color={PALETTE.ivory} roughness={0.8} />
        </RoundedBox>
        <mesh position={[0, 0.605, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.26, 0.34, 40]} />
          <meshStandardMaterial color={PALETTE.coral} emissive={PALETTE.coral} emissiveIntensity={0.25} />
        </mesh>
      </group>

      <Person groupRef={courier} position={[START.x, 0, START.z]} rotationY={0.5} hairStyle="cap" top={PALETTE.forest} bottom="#3A4A44" poseRef={courierPose} still={still} held={<group ref={hand} position={[0, 0.06, 0]} />} />

      <group position={[RECIPIENT.x, 0, RECIPIENT.z]} rotation-y={-2.2}>
        {recipient === 'child' ? (
          <Person scale={0.66} poseRef={recipientPose} hairStyle="pony" top="#7FB6BC" bottom="#5B6E8C" skin={PALETTE.skin2} still={still} held={<group ref={recvHand} />} />
        ) : (
          <Person scale={0.88} poseRef={recipientPose} hairStyle="bun" hair={PALETTE.gray} top="#9C94C4" bottom="#6C6A7C" skin={PALETTE.skin3} glasses still={still} held={<group ref={recvHand} />} />
        )}
      </group>

      <group ref={itemRef} position={[PEDESTAL.x, 0.98, PEDESTAL.z]}>
        {ITEM_NODE[item]}
      </group>

      <group ref={hearts} visible={false}>
        {Array.from({ length: 9 }).map((_, i) => (
          <group key={i}>
            <Heart size={0.22} color={i % 3 === 0 ? PALETTE.coralDeep : PALETTE.coral} />
          </group>
        ))}
      </group>
    </>
  )
}

export default function ExperienceCanvas(props: { item: ItemKind; playToken: number; onPhase: (p: StoryPhase) => void; still?: boolean; waveToken: number; onCourierClick: () => void }) {
  const [visible, setVisible] = useState(true)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 })
    if (wrap.current) io.observe(wrap.current)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={wrap} className="absolute inset-0">
      <Canvas
        dpr={[1, 1.75]}
        frameloop={visible ? 'always' : 'never'}
        camera={{ position: [-0.4, 4.4, 11.5], fov: 36 }}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05 }}
        onPointerMissed={() => undefined}
      >
        <SceneLights />
        <Environment resolution={64} frames={1}>
          <Lightformer intensity={1.2} position={[0, 5, -6]} scale={[10, 4, 1]} color="#FFF6E8" />
          <Lightformer intensity={0.6} position={[-6, 2, 2]} scale={[4, 4, 1]} color="#DCE9DA" />
        </Environment>
        <group onClick={(e) => { e.stopPropagation(); props.onCourierClick() }}>
          <Story {...props} />
        </group>
      </Canvas>
    </div>
  )
}

import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float, Html, Environment, Lightformer, AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import type { CategoryId } from '../lib/types'
import {
  Bench, BlanketRoll, BookStack, Book, ClothesStack, DonationBox, FoodPack, House, Island, PALETTE, PathRibbon, Person, SceneLights, SortingTable, ToyBlocks, Tree, Cane, Heart,
} from './primitives'

export interface HeroSceneProps {
  onPick: (cat: CategoryId) => void
  scrollRef: MutableRefObject<number>
  still?: boolean
  mobile?: boolean
  /** shifts the whole scene right so it sits beside the headline on wide screens */
  offsetX?: number
}

const OBJECTS: Array<{ cat: CategoryId; label: string; pos: [number, number, number]; mobilePos: [number, number, number]; node: JSX.Element; rot?: number }> = [
  { cat: 'books', label: 'Books & stationery', pos: [-3.3, 2.5, 1.2], mobilePos: [-1.5, 3.3, 1], node: <BookStack />, rot: 0.4 },
  { cat: 'clothes', label: 'Clothes & footwear', pos: [2.2, 3.3, 0.6], mobilePos: [1.5, 3.6, 0.6], node: <ClothesStack /> },
  { cat: 'packaged_food', label: 'Packaged food', pos: [3.3, 1.9, 2.2], mobilePos: [1.7, 2.4, 1.6], node: <FoodPack /> },
  { cat: 'toys', label: 'Toys & games', pos: [-4.2, 1.1, 2.1], mobilePos: [-1.7, 2.3, 1.8], node: <ToyBlocks /> },
  { cat: 'bedding', label: 'Blankets & bedding', pos: [-0.2, 3.9, -0.6], mobilePos: [0, 4.3, -0.4], node: <BlanketRoll /> },
]

function FloatingObject({ cat, label, position, node, rot = 0, onPick, still }: { cat: CategoryId; label: string; position: [number, number, number]; node: JSX.Element; rot?: number; onPick: (c: CategoryId) => void; still?: boolean }) {
  const [hover, setHover] = useState(false)
  const g = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (!g.current) return
    const s = THREE.MathUtils.damp(g.current.scale.x, hover ? 1.22 : 1, 8, dt)
    g.current.scale.setScalar(s)
    if (hover && !still) g.current.rotation.y += dt * 1.2
  })
  useEffect(() => () => void (document.body.style.cursor = ''), [])
  return (
    <Float speed={still ? 0 : 1.6} rotationIntensity={still ? 0 : 0.6} floatIntensity={still ? 0 : 0.9} position={position}>
      <group
        ref={g}
        rotation-y={rot}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = '' }}
        onClick={(e) => { e.stopPropagation(); onPick(cat) }}
      >
        {/* generous invisible hit area for touch */}
        <mesh visible={false}>
          <sphereGeometry args={[0.6, 8, 8]} />
        </mesh>
        <group scale={1.25}>{node}</group>
      </group>
      {hover && (
        <Html center position={[0, 0.85, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded-full bg-forest px-3.5 py-1.5 text-[12px] font-bold text-ivory shadow-lift">{label} →</div>
        </Html>
      )}
    </Float>
  )
}

function Rig({ scrollRef, mobile }: { scrollRef: MutableRefObject<number>; mobile?: boolean }) {
  const { camera, pointer } = useThree()
  const look = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    const p = scrollRef.current
    const baseZ = mobile ? 15 : 14
    const tx = pointer.x * 0.9 + p * -1.2
    const ty = (mobile ? 4.2 : 3.4) + pointer.y * 0.4 - p * 1.4
    const tz = baseZ - p * 3.2
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 3, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 3, dt)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 3, dt)
    look.set(0, mobile ? 1.4 : 0.9, 0)
    camera.lookAt(look)
  })
  return null
}

function Courier({ still, scrollRef }: { still?: boolean; scrollRef: MutableRefObject<number> }) {
  const g = useRef<THREE.Group | null>(null)
  const pose = useRef<'carry' | 'carryWalk'>('carry')
  useFrame((_, dt) => {
    if (!g.current) return
    const p = scrollRef.current
    // scrolling walks the courier toward the home along the route
    const tx = -0.6 + p * 2.2
    const tz = 1.2 - p * 1.6
    pose.current = Math.abs(g.current.position.x - tx) > 0.02 ? 'carryWalk' : 'carry'
    g.current.position.x = THREE.MathUtils.damp(g.current.position.x, tx, 2.5, dt)
    g.current.position.z = THREE.MathUtils.damp(g.current.position.z, tz, 2.5, dt)
    g.current.rotation.y = THREE.MathUtils.damp(g.current.rotation.y, p > 0.05 ? 0.9 : 0.25, 3, dt)
  })
  return <Person groupRef={g} position={[-0.6, 0, 1.2]} rotationY={0.25} hairStyle="cap" top={PALETTE.forest} bottom="#3A4A44" poseRef={pose} still={still} held={<DonationBox />} />
}

export function HeroCanvas({ onPick, scrollRef, still, mobile, offsetX = 0 }: HeroSceneProps) {
  const curve = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(-4.6, 0, 3), new THREE.Vector3(-1.2, 0, 1.7), new THREE.Vector3(0.9, 0, 0.8), new THREE.Vector3(2.4, 0, -0.5)]), [])
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
        dpr={[1, mobile ? 1.5 : 1.8]}
        frameloop={visible ? 'always' : 'never'}
        camera={{ position: [0, 3.4, mobile ? 15 : 14], fov: mobile ? 38 : 32 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05 }}
        aria-label="Interactive 3D scene: a delivery volunteer carrying a donation box to a community home. Floating items open donation categories."
      >
        <AdaptiveDpr pixelated />
        <SceneLights />
        <Environment resolution={64} frames={1}>
          <Lightformer intensity={1.2} position={[0, 5, -6]} scale={[10, 4, 1]} color="#FFF6E8" />
          <Lightformer intensity={0.6} position={[-6, 2, 2]} scale={[4, 4, 1]} color="#DCE9DA" />
          <Lightformer intensity={0.5} position={[6, 2, 2]} scale={[4, 4, 1]} color="#F7D9CC" />
        </Environment>
        <Rig scrollRef={scrollRef} mobile={mobile} />
        <Suspense fallback={null}>
          <group position={[offsetX, 0, 0]} scale={offsetX ? 0.82 : 1}>
          <group position={[0, -0.6, 0]}>
            <Island still={still} />
            <PathRibbon curve={curve} />
            <House position={[2.9, 0, -1.6]} rotationY={-0.35} />
            <House position={[-2.6, 0, -2.2]} roof={PALETTE.forestLight} wall="#EDE5D3" scale={0.85} rotationY={0.4} />
            <Tree position={[-4, 0, -0.6]} scale={1.1} still={still} />
            <Tree position={[4.4, 0, 0.6]} scale={0.9} phase={1} still={still} />
            <Tree position={[0.6, 0, -3.4]} scale={1.25} phase={2} still={still} />
            <Tree position={[-1.2, 0, -3.8]} scale={0.8} phase={3} still={still} />
            <Courier still={still} scrollRef={scrollRef} />
            {/* child reading on a bench */}
            <Bench position={[1.3, 0, -2.1]} rotationY={-0.2} />
            <Person position={[1.3, 0.1, -2.05]} rotationY={-0.2} scale={0.62} pose="read" hairStyle="pony" top="#7FB6BC" bottom="#5B6E8C" skin={PALETTE.skin2} phase={1.3} still={still} held={<Book scale={0.6} color={PALETTE.forestLight} />} />
            {/* elder receiving essentials */}
            <group position={[3.9, 0, -0.5]} rotation-y={-0.9}>
              <Person scale={0.86} pose="cane" hairStyle="bun" hair={PALETTE.gray} top="#9C94C4" bottom="#6C6A7C" skin={PALETTE.skin3} glasses phase={2.1} still={still} />
              <group position={[0.36, 0, 0.08]}><Cane /></group>
            </group>
            {/* volunteers sorting donations */}
            <SortingTable position={[-2.5, 0, 0.1]} rotationY={0.5} />
            <Person position={[-2.85, 0, -0.45]} rotationY={0.5} scale={0.9} pose="sort" hairStyle="short" top={PALETTE.sageDeep} skin={PALETTE.skin1} phase={0.5} still={still} />
            <Person position={[-2.05, 0, -0.3]} rotationY={0.2} scale={0.88} pose="sort" hairStyle="bun" hair="#4A3426" top="#E3C47A" bottom="#4A504A" skin={PALETTE.skin2} phase={2.4} still={still} />
            <group position={[2.35, 2.25, -0.95]}>
              <Float speed={still ? 0 : 2} floatIntensity={still ? 0 : 0.6} rotationIntensity={0}>
                <Heart size={0.28} />
              </Float>
            </group>
          </group>
          {OBJECTS.map((o) => (
            <FloatingObject key={o.cat} cat={o.cat} label={o.label} position={mobile ? o.mobilePos : o.pos} node={o.node} rot={o.rot} onPick={onPick} still={still} />
          ))}
          </group>
        </Suspense>
      </Canvas>
    </div>
  )
}

export default HeroCanvas

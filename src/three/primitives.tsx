import { useMemo, useRef, type ReactNode, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

// All geometry is procedural so the scenes never depend on external model files.

export const PALETTE = {
  ivory: '#F8F6F0',
  cream: '#F1EADC',
  forest: '#173D32',
  forestLight: '#2E6152',
  sage: '#B7CDB5',
  sageDeep: '#8FB08C',
  coral: '#EAA58D',
  coralDeep: '#D9866B',
  charcoal: '#252925',
  cardboard: '#C99A6B',
  cardboardDark: '#A87C52',
  wood: '#B08A64',
  skin1: '#E9B996',
  skin2: '#C98E66',
  skin3: '#9C6A48',
  gray: '#D9D6CF',
}

const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => <meshStandardMaterial color={color} roughness={0.65} metalness={0} {...extra} />

/* ------------------------------------------------------------ blob shadow (cheap, soft) */

let shadowTex: THREE.Texture | null = null
function getShadowTexture() {
  if (shadowTex) return shadowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(23,61,50,0.42)')
  grd.addColorStop(0.55, 'rgba(23,61,50,0.16)')
  grd.addColorStop(1, 'rgba(23,61,50,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  shadowTex = new THREE.CanvasTexture(c)
  return shadowTex
}

export function BlobShadow({ size = 1, position = [0, 0.01, 0] as [number, number, number], opacity = 1 }) {
  const tex = useMemo(getShadowTexture, [])
  return (
    <mesh rotation-x={-Math.PI / 2} position={position} renderOrder={1}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

/* ------------------------------------------------------------ people */

export type Pose = 'idle' | 'walk' | 'carry' | 'carryWalk' | 'cheer' | 'wave' | 'sit' | 'read' | 'cane' | 'sort' | 'give' | 'receive'

export interface PersonProps {
  position?: [number, number, number]
  rotationY?: number
  scale?: number
  skin?: string
  top?: string
  bottom?: string
  hair?: string
  hairStyle?: 'short' | 'bun' | 'cap' | 'bald' | 'pony'
  pose?: Pose
  poseRef?: MutableRefObject<Pose>
  phase?: number
  still?: boolean
  held?: ReactNode
  glasses?: boolean
  shadow?: boolean
  groupRef?: MutableRefObject<THREE.Group | null>
}

const damp = THREE.MathUtils.damp

export function Person({
  position = [0, 0, 0], rotationY = 0, scale = 1, skin = PALETTE.skin1, top = PALETTE.forest, bottom = PALETTE.charcoal, hair = PALETTE.charcoal,
  hairStyle = 'short', pose = 'idle', poseRef, phase = 0, still, held, glasses, shadow = true, groupRef,
}: PersonProps) {
  const body = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const heldRef = useRef<THREE.Group>(null)

  useFrame((state, dt) => {
    if (!body.current) return
    const p = poseRef?.current ?? pose
    const t = still ? 0 : state.clock.elapsedTime + phase
    const d = Math.min(dt, 0.05)
    let lx = 0, rx = 0, alx = 0, arx = 0, alz = 0.1, arz = -0.1, by = 0, hx = 0, hy = 0
    let heldY = 1.06, heldZ = 0.4
    const walk = Math.sin(t * 8)
    switch (p) {
      case 'idle':
        by = Math.sin(t * 2) * 0.012
        hy = Math.sin(t * 0.7) * 0.15
        break
      case 'walk':
        lx = walk * 0.55; rx = -walk * 0.55; alx = -walk * 0.5; arx = walk * 0.5; by = Math.abs(walk) * 0.04
        break
      case 'carry':
        alx = -1.2; arx = -1.2; alz = 0.18; arz = -0.18; by = Math.sin(t * 2) * 0.012
        break
      case 'carryWalk':
        lx = walk * 0.5; rx = -walk * 0.5; alx = -1.2; arx = -1.2; alz = 0.18; arz = -0.18; by = Math.abs(walk) * 0.035
        break
      case 'give':
        alx = -1.45; arx = -1.45; alz = 0.16; arz = -0.16; heldZ = 0.62; heldY = 1.2
        break
      case 'receive':
        alx = -1.3; arx = -1.3; alz = 0.16; arz = -0.16; heldZ = 0.45; heldY = 1.1
        break
      case 'cheer':
        alz = 2.5 + Math.sin(t * 10) * 0.15; arz = -2.5 - Math.sin(t * 10) * 0.15; by = Math.abs(Math.sin(t * 6)) * 0.16; hx = -0.15
        heldY = 2.05; heldZ = 0
        break
      case 'wave':
        arz = -2.5 + Math.sin(t * 7) * 0.35; by = Math.sin(t * 2) * 0.01
        break
      case 'sit':
        lx = -1.5; rx = -1.5; by = -0.34; alx = -0.4; arx = -0.4
        break
      case 'read':
        lx = -1.5; rx = -1.5; by = -0.34; alx = -0.95; arx = -0.95; alz = 0.32; arz = -0.32; hx = 0.32; heldY = 0.98; heldZ = 0.32
        hy = Math.sin(t * 0.5) * 0.05
        break
      case 'cane':
        arx = -0.35; arz = -0.25; by = Math.sin(t * 1.4) * 0.008; hx = 0.08; hy = Math.sin(t * 0.5) * 0.2
        break
      case 'sort':
        alx = -0.9 + Math.sin(t * 3) * 0.25; arx = -0.9 - Math.sin(t * 3) * 0.25; hx = 0.25; by = Math.sin(t * 3) * 0.01
        break
    }
    const k = 10
    legL.current!.rotation.x = damp(legL.current!.rotation.x, lx, k, d)
    legR.current!.rotation.x = damp(legR.current!.rotation.x, rx, k, d)
    armL.current!.rotation.x = damp(armL.current!.rotation.x, alx, k, d)
    armR.current!.rotation.x = damp(armR.current!.rotation.x, arx, k, d)
    armL.current!.rotation.z = damp(armL.current!.rotation.z, alz, k, d)
    armR.current!.rotation.z = damp(armR.current!.rotation.z, arz, k, d)
    body.current.position.y = damp(body.current.position.y, by, k, d)
    head.current!.rotation.x = damp(head.current!.rotation.x, hx, 6, d)
    head.current!.rotation.y = damp(head.current!.rotation.y, hy, 4, d)
    if (heldRef.current) {
      heldRef.current.position.y = damp(heldRef.current.position.y, heldY, 8, d)
      heldRef.current.position.z = damp(heldRef.current.position.z, heldZ, 8, d)
    }
  })

  return (
    <group ref={groupRef} position={position} rotation-y={rotationY} scale={scale}>
      {shadow && <BlobShadow size={1.1} />}
      <group ref={body}>
        {/* legs */}
        {[legL, legR].map((ref, i) => (
          <group key={i} ref={ref} position={[i ? 0.11 : -0.11, 0.78, 0]}>
            <mesh position={[0, -0.36, 0]}>
              <capsuleGeometry args={[0.085, 0.48, 6, 12]} />
              {mat(bottom)}
            </mesh>
            <mesh position={[0, -0.74, 0.05]}>
              <boxGeometry args={[0.15, 0.08, 0.26]} />
              {mat(PALETTE.charcoal)}
            </mesh>
          </group>
        ))}
        {/* torso */}
        <mesh position={[0, 1.1, 0]}>
          <capsuleGeometry args={[0.235, 0.34, 8, 18]} />
          {mat(top)}
        </mesh>
        {/* arms */}
        {[armL, armR].map((ref, i) => (
          <group key={i} ref={ref} position={[i ? 0.31 : -0.31, 1.32, 0]}>
            <mesh position={[0, -0.22, 0]}>
              <capsuleGeometry args={[0.068, 0.34, 6, 10]} />
              {mat(top)}
            </mesh>
            <mesh position={[0, -0.45, 0]}>
              <sphereGeometry args={[0.072, 14, 14]} />
              {mat(skin)}
            </mesh>
          </group>
        ))}
        {/* head */}
        <group ref={head} position={[0, 1.6, 0]}>
          <mesh position={[0, -0.07, 0]}>
            <cylinderGeometry args={[0.07, 0.08, 0.1, 12]} />
            {mat(skin)}
          </mesh>
          <mesh position={[0, 0.13, 0]}>
            <sphereGeometry args={[0.2, 28, 28]} />
            {mat(skin, { roughness: 0.55 })}
          </mesh>
          {/* face */}
          {[-0.07, 0.07].map((x) => (
            <mesh key={x} position={[x, 0.15, 0.185]}>
              <sphereGeometry args={[0.02, 10, 10]} />
              {mat(PALETTE.charcoal, { roughness: 0.3 })}
            </mesh>
          ))}
          {[-0.115, 0.115].map((x) => (
            <mesh key={x} position={[x, 0.08, 0.16]}>
              <sphereGeometry args={[0.03, 10, 10]} />
              <meshStandardMaterial color={PALETTE.coral} transparent opacity={0.55} roughness={0.9} />
            </mesh>
          ))}
          <mesh position={[0, 0.075, 0.19]} rotation={[0, 0, Math.PI]}>
            <torusGeometry args={[0.04, 0.009, 6, 16, Math.PI]} />
            {mat(PALETTE.charcoal)}
          </mesh>
          {glasses && (
            <group position={[0, 0.15, 0.19]}>
              {[-0.07, 0.07].map((x) => (
                <mesh key={x} position={[x, 0, 0]}>
                  <torusGeometry args={[0.042, 0.007, 6, 18]} />
                  {mat(PALETTE.charcoal, { metalness: 0.4 })}
                </mesh>
              ))}
            </group>
          )}
          {/* hair */}
          {hairStyle === 'short' && (
            <mesh position={[0, 0.2, -0.02]} scale={[1.04, 0.8, 1.04]}>
              <sphereGeometry args={[0.2, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
              {mat(hair, { roughness: 0.9 })}
            </mesh>
          )}
          {hairStyle === 'bun' && (
            <>
              <mesh position={[0, 0.2, -0.02]} scale={[1.05, 0.82, 1.05]}>
                <sphereGeometry args={[0.2, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
                {mat(hair, { roughness: 0.9 })}
              </mesh>
              <mesh position={[0, 0.3, -0.16]}>
                <sphereGeometry args={[0.085, 16, 16]} />
                {mat(hair, { roughness: 0.9 })}
              </mesh>
            </>
          )}
          {hairStyle === 'pony' && (
            <>
              <mesh position={[0, 0.2, -0.02]} scale={[1.05, 0.82, 1.05]}>
                <sphereGeometry args={[0.2, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
                {mat(hair, { roughness: 0.9 })}
              </mesh>
              <mesh position={[0, 0.06, -0.21]} rotation-x={0.3}>
                <capsuleGeometry args={[0.05, 0.16, 4, 8]} />
                {mat(hair, { roughness: 0.9 })}
              </mesh>
            </>
          )}
          {hairStyle === 'cap' && (
            <group position={[0, 0.24, 0]}>
              <mesh>
                <sphereGeometry args={[0.205, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
                {mat(PALETTE.coral)}
              </mesh>
              <mesh position={[0, 0.005, 0.17]} rotation-x={-0.12}>
                <boxGeometry args={[0.26, 0.02, 0.18]} />
                {mat(PALETTE.coralDeep)}
              </mesh>
            </group>
          )}
        </group>
        <group ref={heldRef} position={[0, 1.06, 0.4]}>
          {held}
        </group>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------ objects */

export function Heart({ size = 0.2, color = PALETTE.coral }: { size?: number; color?: string }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0, -0.35)
    s.bezierCurveTo(-0.15, -0.2, -0.5, -0.05, -0.5, 0.25)
    s.bezierCurveTo(-0.5, 0.5, -0.2, 0.6, 0, 0.38)
    s.bezierCurveTo(0.2, 0.6, 0.5, 0.5, 0.5, 0.25)
    s.bezierCurveTo(0.5, -0.05, 0.15, -0.2, 0, -0.35)
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 18 })
    g.center()
    return g
  }, [])
  return (
    <mesh geometry={geo} scale={size}>
      {mat(color, { roughness: 0.4 })}
    </mesh>
  )
}

export function DonationBox({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      <RoundedBox args={[0.62, 0.44, 0.46]} radius={0.03} smoothness={3}>
        {mat(PALETTE.cardboard, { roughness: 0.85 })}
      </RoundedBox>
      <mesh position={[0, 0.222, 0]}>
        <boxGeometry args={[0.64, 0.012, 0.12]} />
        {mat('#E8D6B8', { roughness: 0.5 })}
      </mesh>
      <mesh position={[0, 0, 0.232]}>
        <planeGeometry args={[0.2, 0.2]} />
        <meshStandardMaterial color={PALETTE.ivory} roughness={0.8} />
      </mesh>
      <group position={[0, 0, 0.245]}>
        <Heart size={0.17} />
      </group>
    </group>
  )
}

export function Book({ color = PALETTE.forestLight, scale = 1 }: { color?: string; scale?: number }) {
  return (
    <group scale={scale}>
      <RoundedBox args={[0.52, 0.1, 0.38]} radius={0.015} smoothness={2}>
        {mat(color)}
      </RoundedBox>
      <mesh position={[0.012, 0, 0]}>
        <boxGeometry args={[0.5, 0.075, 0.36]} />
        {mat(PALETTE.ivory, { roughness: 0.95 })}
      </mesh>
      <mesh position={[-0.26, 0, 0]}>
        <boxGeometry args={[0.012, 0.102, 0.382]} />
        {mat(color)}
      </mesh>
    </group>
  )
}

export function BookStack({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      <group position={[0, 0, 0]} rotation-y={0.1}><Book color={PALETTE.forestLight} /></group>
      <group position={[0.02, 0.11, 0]} rotation-y={-0.15}><Book color={PALETTE.coral} /></group>
      <group position={[-0.02, 0.22, 0]} rotation-y={0.25}><Book color="#E3C47A" scale={0.9} /></group>
    </group>
  )
}

export function ClothesStack({ scale = 1 }: { scale?: number }) {
  const colors = [PALETTE.sageDeep, PALETTE.coral, PALETTE.cream]
  return (
    <group scale={scale}>
      {colors.map((c, i) => (
        <group key={c} position={[i * 0.015 - 0.015, i * 0.1, 0]} rotation-y={(i - 1) * 0.08}>
          <RoundedBox args={[0.58, 0.09, 0.44]} radius={0.04} smoothness={3}>
            {mat(c, { roughness: 0.95 })}
          </RoundedBox>
          <mesh position={[0, 0.046, 0.06]}>
            <boxGeometry args={[0.5, 0.004, 0.012]} />
            {mat('#000000', { transparent: true, opacity: 0.08 })}
          </mesh>
        </group>
      ))}
    </group>
  )
}

export function FoodPack({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      <RoundedBox args={[0.34, 0.46, 0.22]} radius={0.03} position={[-0.12, 0.08, 0]}>
        {mat('#E9D3A8')}
      </RoundedBox>
      <mesh position={[-0.12, 0.1, 0.112]}>
        <planeGeometry args={[0.26, 0.18]} />
        {mat(PALETTE.forestLight)}
      </mesh>
      <mesh position={[0.2, -0.02, 0.04]}>
        <cylinderGeometry args={[0.11, 0.11, 0.26, 24]} />
        {mat('#D9866B', { roughness: 0.4, metalness: 0.2 })}
      </mesh>
      <mesh position={[0.2, 0.115, 0.04]}>
        <cylinderGeometry args={[0.112, 0.112, 0.02, 24]} />
        {mat('#C9C3B7', { metalness: 0.6, roughness: 0.3 })}
      </mesh>
      <mesh position={[0.2, -0.02, 0.04]}>
        <cylinderGeometry args={[0.1125, 0.1125, 0.1, 24, 1, true]} />
        {mat(PALETTE.ivory)}
      </mesh>
    </group>
  )
}

export function ToyBlocks({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      <RoundedBox args={[0.2, 0.2, 0.2]} radius={0.025} position={[-0.12, 0, 0]} rotation-y={0.3}>{mat('#E89A62')}</RoundedBox>
      <RoundedBox args={[0.2, 0.2, 0.2]} radius={0.025} position={[0.12, 0, 0.02]} rotation-y={-0.2}>{mat(PALETTE.sageDeep)}</RoundedBox>
      <RoundedBox args={[0.2, 0.2, 0.2]} radius={0.025} position={[0, 0.2, 0]} rotation-y={0.6}>{mat('#7FB6BC')}</RoundedBox>
      <mesh position={[0.3, 0.02, 0.18]}>
        <sphereGeometry args={[0.12, 24, 24]} />
        {mat(PALETTE.coral, { roughness: 0.35 })}
      </mesh>
      <mesh position={[0.3, 0.02, 0.18]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.121, 0.012, 8, 32]} />
        {mat(PALETTE.ivory)}
      </mesh>
    </group>
  )
}

export function BlanketRoll({ scale = 1, color = '#9C94C4' }: { scale?: number; color?: string }) {
  return (
    <group scale={scale} rotation-z={Math.PI / 2}>
      <mesh>
        <cylinderGeometry args={[0.17, 0.17, 0.62, 28]} />
        {mat(color, { roughness: 1 })}
      </mesh>
      {[-0.18, 0.18].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.172, 0.02, 8, 32]} />
          {mat(PALETTE.coral)}
        </mesh>
      ))}
      {[-0.311, 0.311].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation-x={y > 0 ? -Math.PI / 2 : Math.PI / 2}>
          <ringGeometry args={[0.04, 0.165, 28]} />
          {mat('#B8B1DA', { side: THREE.DoubleSide })}
        </mesh>
      ))}
    </group>
  )
}

export function Cane() {
  return (
    <group>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.9, 8]} />
        {mat(PALETTE.wood)}
      </mesh>
      <mesh position={[0.05, 0.9, 0]} rotation-z={Math.PI / 2}>
        <torusGeometry args={[0.05, 0.018, 8, 16, Math.PI]} />
        {mat(PALETTE.wood)}
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------ environment */

export function House({ position, roof = PALETTE.coral, wall = PALETTE.cream, scale = 1, rotationY = 0, glow = true }: { position: [number, number, number]; roof?: string; wall?: string; scale?: number; rotationY?: number; glow?: boolean }) {
  return (
    <group position={position} scale={scale} rotation-y={rotationY}>
      <BlobShadow size={3.2} position={[0, 0.01, 0]} opacity={0.9} />
      <RoundedBox args={[1.8, 1.25, 1.4]} radius={0.06} position={[0, 0.625, 0]}>
        {mat(wall, { roughness: 0.9 })}
      </RoundedBox>
      <mesh position={[0, 1.62, 0]} rotation-y={Math.PI / 4} scale={[1.42, 1, 1.12]}>
        <coneGeometry args={[1.2, 0.8, 4, 1]} />
        {mat(roof, { roughness: 0.8, flatShading: true })}
      </mesh>
      <mesh position={[0.5, 1.85, -0.2]}>
        <boxGeometry args={[0.18, 0.45, 0.18]} />
        {mat(PALETTE.cream)}
      </mesh>
      <RoundedBox args={[0.42, 0.72, 0.06]} radius={0.04} position={[0, 0.37, 0.71]}>
        {mat(PALETTE.forest)}
      </RoundedBox>
      <mesh position={[0.13, 0.38, 0.75]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        {mat('#E3C47A', { metalness: 0.6, roughness: 0.3 })}
      </mesh>
      {[-0.58, 0.58].map((x) => (
        <group key={x} position={[x, 0.78, 0.705]}>
          <mesh>
            <boxGeometry args={[0.36, 0.36, 0.03]} />
            {mat(PALETTE.forest)}
          </mesh>
          <mesh position={[0, 0, 0.02]}>
            <planeGeometry args={[0.3, 0.3]} />
            <meshStandardMaterial color="#FFE2B8" emissive="#FFC98A" emissiveIntensity={glow ? 0.9 : 0.2} roughness={0.4} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.02, 0.95]}>
        <boxGeometry args={[0.7, 0.04, 0.45]} />
        {mat('#E4DFD1')}
      </mesh>
    </group>
  )
}

export function Tree({ position, scale = 1, phase = 0, still }: { position: [number, number, number]; scale?: number; phase?: number; still?: boolean }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((s) => {
    if (ref.current && !still) ref.current.rotation.z = Math.sin(s.clock.elapsedTime * 0.8 + phase) * 0.025
  })
  return (
    <group position={position} scale={scale}>
      <BlobShadow size={1.3} />
      <group ref={ref}>
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.06, 0.09, 0.7, 8]} />
          {mat('#8A6A4C')}
        </mesh>
        <mesh position={[0, 0.95, 0]}>
          <icosahedronGeometry args={[0.45, 1]} />
          {mat(PALETTE.sageDeep, { flatShading: true, roughness: 0.9 })}
        </mesh>
        <mesh position={[0.18, 1.25, 0.05]}>
          <icosahedronGeometry args={[0.3, 1]} />
          {mat(PALETTE.sage, { flatShading: true, roughness: 0.9 })}
        </mesh>
      </group>
    </group>
  )
}

export function Bench({ position, rotationY = 0 }: { position: [number, number, number]; rotationY?: number }) {
  return (
    <group position={position} rotation-y={rotationY}>
      <BlobShadow size={1.4} />
      <RoundedBox args={[0.9, 0.06, 0.34]} radius={0.02} position={[0, 0.44, 0]}>{mat(PALETTE.wood)}</RoundedBox>
      <RoundedBox args={[0.9, 0.3, 0.05]} radius={0.02} position={[0, 0.66, -0.15]}>{mat(PALETTE.wood)}</RoundedBox>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]}>
          <boxGeometry args={[0.05, 0.44, 0.3]} />
          {mat(PALETTE.charcoal)}
        </mesh>
      ))}
    </group>
  )
}

export function SortingTable({ position, rotationY = 0 }: { position: [number, number, number]; rotationY?: number }) {
  return (
    <group position={position} rotation-y={rotationY}>
      <BlobShadow size={1.8} />
      <RoundedBox args={[1.3, 0.06, 0.6]} radius={0.02} position={[0, 0.72, 0]}>{mat('#E4DFD1')}</RoundedBox>
      {[[-0.58, -0.24], [0.58, -0.24], [-0.58, 0.24], [0.58, 0.24]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.36, z]}>
          <cylinderGeometry args={[0.025, 0.025, 0.72, 8]} />
          {mat(PALETTE.charcoal)}
        </mesh>
      ))}
      <group position={[-0.32, 0.92, 0]}><DonationBox scale={0.55} /></group>
      <group position={[0.15, 0.8, 0.05]}><ClothesStack scale={0.45} /></group>
      <group position={[0.45, 0.78, -0.05]}><Book scale={0.5} color={PALETTE.coral} /></group>
    </group>
  )
}

export function Island({ radius = 5.4, still }: { radius?: number; still?: boolean }) {
  const grass = useRef<THREE.Mesh>(null)
  useFrame((s) => {
    if (grass.current && !still) grass.current.rotation.y = s.clock.elapsedTime * 0.01
  })
  return (
    <group>
      <mesh position={[0, -0.32, 0]}>
        <cylinderGeometry args={[radius * 0.98, radius * 0.86, 0.62, 64]} />
        {mat('#E8DCC6', { roughness: 1 })}
      </mesh>
      <mesh position={[0, -0.7, 0]}>
        <cylinderGeometry args={[radius * 0.86, radius * 0.6, 0.3, 64]} />
        {mat('#D8C9AE', { roughness: 1 })}
      </mesh>
      <mesh ref={grass} position={[0, 0, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[radius, 64]} />
        {mat('#CFDFCB', { roughness: 1 })}
      </mesh>
      <mesh position={[0, 0.003, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[radius - 0.12, radius, 64]} />
        {mat(PALETTE.sage, { roughness: 1 })}
      </mesh>
    </group>
  )
}

export function PathRibbon({ curve, width = 0.55 }: { curve: THREE.Curve<THREE.Vector3>; width?: number }) {
  const geo = useMemo(() => {
    const pts = curve.getSpacedPoints(80)
    const positions: number[] = []
    const idx: number[] = []
    pts.forEach((p, i) => {
      const t = curve.getTangentAt(i / 80)
      const n = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(width / 2)
      positions.push(p.x + n.x, 0.012, p.z + n.z, p.x - n.x, 0.012, p.z - n.z)
      if (i < pts.length - 1) {
        const a = i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [curve, width])
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color="#EFE6D3" roughness={1} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function SceneLights({ intensity = 1 }: { intensity?: number }) {
  return (
    <>
      <hemisphereLight args={['#FFF8EC', '#B7CDB5', 0.9 * intensity]} />
      <directionalLight position={[5, 8, 6]} intensity={1.6 * intensity} color="#FFF1DE" />
      <directionalLight position={[-6, 4, -4]} intensity={0.5 * intensity} color="#CFE0F0" />
      <ambientLight intensity={0.25 * intensity} />
    </>
  )
}

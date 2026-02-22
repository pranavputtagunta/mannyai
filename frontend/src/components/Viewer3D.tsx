import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stage, useGLTF } from "@react-three/drei";
import "../assets/Viewer3D.css";

interface ModelProps {
  url: string;
}

function Model({ url }: Readonly<ModelProps>) {
  const { scene } = useGLTF(url);
  const primitiveProps = { object: scene };

  return <primitive {...primitiveProps} />;
}

interface Viewer3DProps {
  modelUrl: string | null;
}

export default function Viewer3D({ modelUrl }: Readonly<Viewer3DProps>) {
  return (
    <div className="viewer-wrapper">
      <Canvas
        shadows
        camera={{ position: [0, 2, 5], fov: 45 }}
        style={{ background: "#171717" }}
      >
        <Suspense fallback={null}>
          {modelUrl && (
            <Stage environment="city" intensity={0.6} shadows="contact">
              <Model url={modelUrl} />
            </Stage>
          )}
        </Suspense>

        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
      </Canvas>
    </div>
  );
}

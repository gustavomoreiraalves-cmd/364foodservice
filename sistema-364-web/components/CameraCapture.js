'use client';
import { useEffect, useRef } from 'react';

// Liga a câmera frontal e entrega o <video> pronto via onVideoPronto(videoEl).
// O chamador roda seu próprio loop de detecção sobre o elemento.
export default function CameraCapture({ onVideoPronto, onErro, className }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    let ativo = true;
    async function ligar() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (!ativo) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        onVideoPronto?.(video);
      } catch (err) {
        onErro?.('Não foi possível acessar a câmera: ' + err.message);
      }
    }
    ligar();
    return () => {
      ativo = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return <video ref={videoRef} muted playsInline className={className} />;
}

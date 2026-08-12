'use client';
// Reconhecimento facial no navegador com @vladmandic/face-api.
// Modelos servidos localmente de /public/models (sem serviço externo).
// Calibração em campo: ajustar as constantes abaixo se houver
// falso negativo (subir LIMIAR_MATCH) ou falso positivo (descer).

export const LIMIAR_MATCH = 0.45;      // distância euclidiana máxima p/ aceitar
export const MARGEM_SEGUNDO = 0.05;    // distância mínima p/ o 2º colocado
export const ZONA_CINZENTA = 0.5;      // entre LIMIAR e isto: recaptura e tira média
export const LIMIAR_EAR = 0.2;         // olho fechado quando EAR < 0.20
export const EAR_ABERTO = 0.28;        // olho reaberto quando EAR > 0.28
export const QUALIDADE_MINIMA = 0.8;   // score mínimo de detecção no cadastro

let faceapi = null;
let carregado = false;

export async function carregarModelos() {
  if (carregado) return faceapi;
  faceapi = await import('@vladmandic/face-api');
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
  ]);
  carregado = true;
  return faceapi;
}

const OPCOES = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });

// Detecta 1 rosto com landmarks (sem descritor — rápido, para o loop de vídeo).
export async function detectarComLandmarks(video) {
  const det = await faceapi.detectAllFaces(video, OPCOES()).withFaceLandmarks();
  return det; // array; chamador valida length === 1
}

// Extrai o descritor 128-d do rosto (mais pesado — usar só no momento certo).
export async function extrairDescritor(video) {
  const det = await faceapi
    .detectSingleFace(video, OPCOES())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!det) return null;
  return { descritor: Array.from(det.descriptor), score: det.detection.score };
}

export function distancia(d1, d2) {
  let soma = 0;
  for (let i = 0; i < d1.length; i++) {
    const dif = d1[i] - d2[i];
    soma += dif * dif;
  }
  return Math.sqrt(soma);
}

// Compara um descritor capturado contra a base sincronizada
// [{id, primeiroNome, descritores: [[...], ...]}].
// Retorna { colaborador, melhor, segundo } (menor distância entre as amostras de cada um).
export function melhorMatch(descritor, colaboradores) {
  let melhor = { colaborador: null, dist: Infinity };
  let segundo = { colaborador: null, dist: Infinity };
  for (const c of colaboradores) {
    let d = Infinity;
    for (const amostra of c.descritores) d = Math.min(d, distancia(descritor, amostra));
    if (d < melhor.dist) { segundo = melhor; melhor = { colaborador: c, dist: d }; }
    else if (d < segundo.dist) { segundo = { colaborador: c, dist: d }; }
  }
  return { melhor, segundo };
}

// EAR (Eye Aspect Ratio) clássico a partir dos 6 pontos de cada olho.
function earDeOlho(p) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]));
}

export function calcularEAR(landmarks) {
  return (earDeOlho(landmarks.getLeftEye()) + earDeOlho(landmarks.getRightEye())) / 2;
}

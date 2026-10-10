# Transcreve AI

Aplicação web para transcrever vídeos e áudios em português. A extração do áudio e o reconhecimento de voz acontecem no navegador; o arquivo de origem não é enviado para um servidor.

## Como funciona

- O FFmpeg WebAssembly extrai o áudio do vídeo no navegador.
- Transformers.js executa o modelo Whisper Tiny no próprio dispositivo.
- O texto pode ser revisado, copiado e baixado como `.txt`.
- Na primeira utilização, o navegador baixa o modelo de voz. O modelo e as bibliotecas são servidos por fornecedores externos e podem ser guardados em cache pelo navegador.

## Executar localmente

Requer Node.js 20 ou superior.

```sh
npm install
npm run dev
```

## Publicar no Vercel

1. Coloque esta pasta num repositório GitHub pessoal.
2. No Vercel, escolha **Add New → Project** e importe o repositório.
3. O arquivo `vercel.json` configura a instalação e compilação. O comando de compilação é `npm run build` e a saída é `dist`.
4. Publique no plano Hobby para um projeto pessoal.

## Limitações

O tempo de transcrição depende do computador, do tamanho e da duração do vídeo e do navegador. Vídeos longos ou arquivos grandes podem consumir muita memória. A precisão depende da qualidade do áudio e do modelo compacto escolhido. Esta versão não guarda transcrições em um servidor.

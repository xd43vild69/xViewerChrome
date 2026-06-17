let comfySocket = null;
let currentPromptId = null;
const clientId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

function connectComfySocket() {
  if (comfySocket) return;
  comfySocket = new WebSocket(`ws://localhost:8188/ws?clientId=${clientId}`);
  
  comfySocket.addEventListener('message', async (event) => {
    if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'executing' || msg.type === 'executed') {
          console.log('WS Event:', msg.type, msg.data);
        }
        
        // Escuchamos el evento 'executed' que expone el nodo que guardó la imagen y el nombre resultante
        if (msg.type === 'executed' && msg.data.prompt_id === currentPromptId) {
          const output = msg.data.output;
          if (output && output.images && output.images.length > 0) {
            const imgInfo = output.images[0];
            let url = `http://localhost:8188/view?filename=${encodeURIComponent(imgInfo.filename)}&type=${imgInfo.type}`;
            if (imgInfo.subfolder) {
              url += `&subfolder=${encodeURIComponent(imgInfo.subfolder)}`;
            }
            url += `&t=${Date.now()}`; // Evitar caché
            
            // 4. Recuperación del Asset
            const res = await fetch(url);
            if (!res.ok) {
              console.error(`Error al recuperar la imagen: HTTP ${res.status}`, await res.text());
              return;
            }
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            showResultImage(blobUrl);
          }
        }
      } catch (err) {
        console.error('Error parseando WS message', err);
      }
    }
  });
  
  comfySocket.addEventListener('close', () => {
    comfySocket = null;
  });
}

function showResultImage(url) {
  let overlay = document.getElementById('result-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'result-overlay';
    // Estilos para oscurecer el fondo y centrar la imagen
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';
    overlay.style.cursor = 'pointer';
    overlay.title = 'Click para cerrar';
    
    const img = document.createElement('img');
    img.id = 'result-img';
    img.style.maxWidth = '90%';
    img.style.maxHeight = '90%';
    img.style.border = '2px solid #0f0';
    img.style.boxShadow = '0 0 20px #0f0';
    
    overlay.addEventListener('click', () => {
      overlay.style.display = 'none';
      URL.revokeObjectURL(img.src);
      img.src = '';
    });
    
    overlay.appendChild(img);
    document.body.appendChild(overlay);
  }
  
  const imgElement = document.getElementById('result-img');
  imgElement.src = url;
  overlay.style.display = 'flex';
}

// Iniciar conexión WS
connectComfySocket();

document.getElementById('file-input').addEventListener('change', (event) => {
  const grid = document.getElementById('grid');
  grid.innerHTML = ''; // Limpiar buffer visual de renderizados previos

  const files = event.target.files; // Array-like con objetos File

  if (!files || files.length === 0) return;

  let firstImage = true;

  // Iteración sobre la lista de archivos indexados
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Filtrado estricto por tipo MIME (solo jpeg, jpg, png)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.type)) {
      // Generación de la URL temporal en el contexto de la extensión
      const imgUrl = URL.createObjectURL(file);
      
      const img = document.createElement('img');
      img.src = imgUrl;
      img.classList.add('img-card');
      img.title = file.name; // Tooltip con el nombre del archivo
      img.file = file; // Guardar referencia al archivo original
      
      // Garbage collection de memoria una vez renderizado el elemento
      img.onload = () => { 
        URL.revokeObjectURL(imgUrl); 
      };

      if (firstImage) {
        img.classList.add('selected');
        firstImage = false;
      }

      // Actualizar la imagen seleccionada al pasar el ratón
      img.addEventListener('mouseenter', () => {
        const prevSelected = document.querySelector('.img-card.selected');
        if (prevSelected) {
          prevSelected.classList.remove('selected');
        }
        img.classList.add('selected');
      });

      // Funcionalidad de pantalla completa al hacer doble clic
      img.addEventListener('dblclick', () => {
        if (!document.fullscreenElement) {
          img.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen mode: ${err.message}`);
          });
        } else {
          document.exitFullscreen();
        }
      });

      grid.appendChild(img);
    }
  }
});

// Escuchar teclas globales (Espacio, flechas y Enter)
document.addEventListener('keydown', async (event) => {
  if (event.code === 'Enter') {
    event.preventDefault();
    const selectedImg = document.querySelector('.img-card.selected');
    if (!selectedImg || !selectedImg.file) return;

    try {
      // 1. Subir la imagen
      const formData = new FormData();
      // Asegurar que usamos un nombre de archivo único para evitar que ComfyUI use la caché
      const originalName = selectedImg.file.name.split(/[/\\]/).pop();
      const uniqueName = `img_${Date.now()}_${originalName}`;
      formData.append('image', selectedImg.file, uniqueName);
      formData.append('type', 'input');
      formData.append('overwrite', 'true');
      
      const uploadRes = await fetch('http://localhost:8188/upload/image', {
        method: 'POST',
        body: formData
      });
      const uploadData = await uploadRes.json();
      const finalImageName = uploadData.name;

      // 2. Obtener y modificar el workflow
      const wfRes = await fetch('./workflows/RescalerBaseChrome.json');
      const workflow = await wfRes.json();
      
      // Buscar el nodo LoadImage para actualizar la imagen y forzar recálculo
      for (const nodeId in workflow) {
        if (workflow[nodeId].class_type === 'LoadImage') {
          workflow[nodeId].inputs.image = finalImageName;
        }
        // Randomizar cualquier semilla (seed) en los nodos para destruir completamente la caché de ComfyUI
        if (workflow[nodeId].inputs && typeof workflow[nodeId].inputs.seed !== 'undefined') {
          workflow[nodeId].inputs.seed = Math.floor(Math.random() * 2147483647);
        }
      }

      // 3. Enviar el workflow a la cola de ComfyUI
      const promptRes = await fetch('http://localhost:8188/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: clientId })
      });
      const promptData = await promptRes.json();
      
      currentPromptId = promptData.prompt_id;
      console.log('Prompt encolado con ID:', currentPromptId);
      // Opcional: mostrar un indicador visual de "Procesando..."
    } catch (err) {
      console.error('Error enviando a ComfyUI:', err);
    }
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault(); // Evitar que la página haga scroll
    if (!document.fullscreenElement) {
      // Buscar si hay alguna imagen seleccionada
      const selectedImg = document.querySelector('.img-card.selected');
      if (selectedImg) {
        selectedImg.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable fullscreen mode: ${err.message}`);
        });
      }
    } else {
      // Si ya está en pantalla completa, salir
      document.exitFullscreen();
    }
    return;
  }

  // Navegación con flechas
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (keys.includes(event.code)) {
    event.preventDefault(); // Evitar scroll con las flechas
    
    const grid = document.getElementById('grid');
    const children = Array.from(grid.children);
    if (children.length === 0) return;

    const selectedIndex = children.findIndex(img => img.classList.contains('selected'));
    if (selectedIndex === -1) return;

    // Calcular el número de columnas de la cuadrícula
    let cols = children.length;
    const firstTop = children[0].offsetTop;
    for (let i = 1; i < children.length; i++) {
      if (children[i].offsetTop > firstTop) {
        cols = i;
        break;
      }
    }

    let newIndex = selectedIndex;

    if (event.code === 'ArrowLeft') {
      newIndex = selectedIndex - 1;
    } else if (event.code === 'ArrowRight') {
      newIndex = selectedIndex + 1;
    } else if (event.code === 'ArrowUp') {
      newIndex = selectedIndex - cols;
    } else if (event.code === 'ArrowDown') {
      newIndex = selectedIndex + cols;
    }

    // Asegurarse de que el nuevo índice esté dentro de los límites
    if (newIndex >= 0 && newIndex < children.length) {
      children[selectedIndex].classList.remove('selected');
      children[newIndex].classList.add('selected');
      
      // Hacer scroll para asegurar que la nueva imagen sea visible
      children[newIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Si estamos en pantalla completa, actualizar la imagen a pantalla completa
      if (document.fullscreenElement) {
        children[newIndex].requestFullscreen().catch(err => console.error(err));
      }
    }
  }
});
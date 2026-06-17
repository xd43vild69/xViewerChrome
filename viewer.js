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
      // Asegurar que usamos solo el nombre del archivo (sin rutas relativas que puedan causar 500 en el backend)
      formData.append('image', selectedImg.file, selectedImg.file.name.split(/[/\\]/).pop());
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
      
      // Buscar el nodo LoadImage para actualizar la imagen
      for (const nodeId in workflow) {
        if (workflow[nodeId].class_type === 'LoadImage') {
          workflow[nodeId].inputs.image = finalImageName;
          break;
        }
      }

      // 3. Enviar el workflow a la cola de ComfyUI
      const promptRes = await fetch('http://localhost:8188/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow })
      });
      const promptData = await promptRes.json();
      
      console.log('Prompt encolado con ID:', promptData.prompt_id);
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
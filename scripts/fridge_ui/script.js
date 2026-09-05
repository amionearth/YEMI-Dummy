// Golden Fridge Standalone UI & Gesture Controller
(function () {
  const fridge = document.querySelector('#fridge');
  const door = document.querySelector('#door');
  const closeDoor = document.querySelector('#close-door');
  const shelves = document.querySelector('#shelves');
  const petCharacter = document.querySelector('#pet-character');
  const petBubble = document.querySelector('#pet-bubble');
  const petBubbleText = document.querySelector('#pet-bubble-text');
  const petMoodBadge = document.querySelector('#pet-mood-badge');
  const handCursor = document.querySelector('#hand-cursor');
  const cursorBadge = document.querySelector('#cursor-badge');
  const toastBanner = document.querySelector('#toast-banner');
  const btnCloseApp = document.querySelector('#btn-close-app');
  const btnRefresh = document.querySelector('#btn-refresh');

  let dragged = null;
  let originSlot = null;
  let isHandPinching = false;
  let lastPalmToggleTime = 0;
  let toastTimeout = null;

  // Lightweight Python Bridge using document.title signaling
  window.pyBridge = {
    onItemFed: function (fileName, name) {
      document.title = 'PYACTION:FEED:' + encodeURIComponent(fileName) + ':' + encodeURIComponent(name);
    },
    onDoorChanged: function (isOpen) {
      document.title = 'PYACTION:DOOR:' + (isOpen ? '1' : '0');
    },
    closeApp: function () {
      document.title = 'PYACTION:CLOSE';
    },
    refreshFiles: function () {
      document.title = 'PYACTION:REFRESH';
    },
  };

  // Default initial foods (9 slots max)
  let fridgeFoods = [
    { name: 'Red Apple', emoji: '🍎', file: '01_apple.md' },
    { name: 'Cold Milk', emoji: '🥛', file: '02_milk.txt' },
    { name: 'Sharp Cheese', emoji: '🧀', file: '03_cheese.md' },
    { name: 'Wild Grapes', emoji: '🍇', file: '04_grapes.txt' },
    { name: 'Fresh Fish', emoji: '🐟', file: '05_fish.md' },
    { name: 'Honey Cake', emoji: '🍰', file: '06_cake.txt' },
    null,
    null,
    null,
  ];

  // Show Toast Message
  function showToast(message, duration = 3000) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toastBanner.textContent = message;
    toastBanner.classList.add('active');
    toastTimeout = setTimeout(() => {
      toastBanner.classList.remove('active');
    }, duration);
  }

  // Create Food Element
  function makeFood(item) {
    const food = document.createElement('button');
    food.className = 'food';
    food.type = 'button';
    food.dataset.name = item.name;
    food.dataset.emoji = item.emoji;
    food.dataset.file = item.file || '';
    food.setAttribute('aria-label', `Take ${item.name}`);
    food.textContent = item.emoji;

    // Hover label tag
    const tag = document.createElement('span');
    tag.className = 'food-label-tag';
    tag.textContent = item.name;
    food.appendChild(tag);

    food.addEventListener('pointerdown', startDrag);
    return food;
  }

  // Render Shelves (3x3 grid = exactly 9 slots)
  function renderShelves() {
    shelves.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.slotIndex = i;
      slot.setAttribute('aria-label', `Storage space ${i + 1}`);

      if (fridgeFoods[i]) {
        slot.appendChild(makeFood(fridgeFoods[i]));
      } else {
        slot.classList.add('free');
      }
      shelves.appendChild(slot);
    }
  }

  // Initialize Slots
  renderShelves();

  // --- Drag & Drop Core ---
  function startDrag(event) {
    if (dragged || (event.button !== undefined && event.button !== 0)) return;
    if (event.preventDefault) event.preventDefault();

    dragged = event.currentTarget;
    originSlot = dragged.parentElement;
    originSlot.classList.add('free');
    dragged.classList.add('dragging');
    document.body.appendChild(dragged);

    const clientX = event.clientX !== undefined ? event.clientX : event.x;
    const clientY = event.clientY !== undefined ? event.clientY : event.y;
    updateDragPos(clientX, clientY);

    if (event.type === 'pointerdown') {
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp, { once: true });
    }
  }

  function updateDragPos(clientX, clientY) {
    if (!dragged) return;
    dragged.style.left = `${clientX}px`;
    dragged.style.top = `${clientY}px`;

    // Drop target highlighting
    const below = document.elementFromPoint(clientX, clientY);
    const targetSlot = below?.closest('.slot');
    const targetPet = below?.closest('#pet-character') || below?.closest('.pet-stage');

    document.querySelectorAll('.slot.drop-target').forEach(s => s.classList.remove('drop-target'));
    if (petCharacter) petCharacter.classList.remove('drop-target');

    if (targetPet && petCharacter) {
      petCharacter.classList.add('drop-target');
      if (petCharacter.dataset.state !== 'eating') {
        petCharacter.dataset.state = 'waiting';
      }
      if (petBubbleText) petBubbleText.textContent = "Drop it in my mouth! 😋";
    } else {
      if (petCharacter && petCharacter.dataset.state === 'waiting') {
        petCharacter.dataset.state = 'idle';
      }
      if (targetSlot && (!targetSlot.firstElementChild || targetSlot === originSlot)) {
        targetSlot.classList.add('drop-target');
      }
    }
  }

  function onPointerMove(event) {
    updateDragPos(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    document.removeEventListener('pointermove', onPointerMove);
    finishDrag(event.clientX, event.clientY);
  }

  function finishDrag(clientX, clientY) {
    if (!dragged) return;

    const below = document.elementFromPoint(clientX, clientY);
    const targetPet = below?.closest('#pet-character') || below?.closest('.pet-stage');
    const destinationSlot = below?.closest('.slot');

    // Case 1: Dropped onto Pet!
    if (targetPet) {
      feedPetItem(dragged);
      cleanupDrag();
      return;
    }

    // Case 2: Dropped into empty slot
    const validSlot = destinationSlot && (!destinationSlot.firstElementChild || destinationSlot === originSlot);
    const target = validSlot ? destinationSlot : originSlot;

    target.appendChild(dragged);
    target.classList.remove('free', 'drop-target');
    document.querySelectorAll('.slot.drop-target').forEach(s => s.classList.remove('drop-target'));

    cleanupDrag();
  }

  function cleanupDrag() {
    if (!dragged) return;
    dragged.classList.remove('dragging');
    dragged.style.left = '';
    dragged.style.top = '';
    dragged = null;
    originSlot = null;
    if (petCharacter) petCharacter.classList.remove('drop-target');
  }

  // Feeding an item to Tink
  function feedPetItem(foodElem) {
    const name = foodElem.dataset.name || 'Food Specimen';
    const fileName = foodElem.dataset.file || '';

    // Play Bounce/Eating Animation on Tink
    if (petCharacter) {
      petCharacter.classList.add('eating');
      petCharacter.dataset.state = 'jumping';
      setTimeout(() => {
        petCharacter.classList.remove('eating');
        if (petCharacter.dataset.state === 'jumping') {
          petCharacter.dataset.state = 'idle';
        }
      }, 1600);
    }

    if (petMoodBadge) {
      petMoodBadge.textContent = 'TASTING...';
      petMoodBadge.className = 'bubble-badge eating';
    }

    if (petBubbleText) {
      petBubbleText.textContent = `Nom nom nom! Ingesting '${name}'... 🐾`;
    }

    showToast(`🍽 Tink caught and devoured '${name}'! Real-time AI digesting...`);

    // Notify Python backend via title change
    if (window.pyBridge && window.pyBridge.onItemFed) {
      window.pyBridge.onItemFed(fileName, name);
    }

    // Remove element and free origin slot
    if (originSlot) {
      originSlot.classList.add('free');
    }
    foodElem.remove();
  }

  // Public bridge for Python to update Tink's speech bubble with real-time reaction
  window.setPetReaction = function (reactionText, mood = "HAPPY") {
    if (petBubbleText) petBubbleText.textContent = reactionText;
    if (petMoodBadge) {
      petMoodBadge.textContent = mood;
      petMoodBadge.className = 'bubble-badge';
    }
    if (petCharacter) {
      petCharacter.dataset.state = 'waving';
      setTimeout(() => {
        if (petCharacter.dataset.state === 'waving') {
          petCharacter.dataset.state = 'idle';
        }
      }, 4000);
    }
  };

  // --- Door Open / Close ---
  function setDoor(open) {
    fridge.classList.toggle('open', open);
    const isOpen = fridge.classList.contains('open');
    door.setAttribute('aria-label', isOpen ? 'Close refrigerator door' : 'Open refrigerator door');

    // Notify Python
    if (window.pyBridge && window.pyBridge.onDoorChanged) {
      window.pyBridge.onDoorChanged(isOpen);
    }
  }

  function toggleDoor() {
    const isOpen = fridge.classList.contains('open');
    setDoor(!isOpen);
    showToast(isOpen ? '🚪 Fridge Closed' : '✨ Fridge Opened!');
  }

  door.addEventListener('click', toggleDoor);
  closeDoor.addEventListener('click', () => setDoor(false));

  if (btnCloseApp) {
    btnCloseApp.addEventListener('click', () => {
      if (window.pyBridge && window.pyBridge.closeApp) {
        window.pyBridge.closeApp();
      }
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      if (window.pyBridge && window.pyBridge.refreshFiles) {
        window.pyBridge.refreshFiles();
      }
    });
  }

  // --- Hand Tracking Bridge (called by Python) ---
  window.updateHandCursor = function (normX, normY, isPinching, isPalmClose, gestureLabel) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const cx = Math.max(10, Math.min(screenW - 10, normX * screenW));
    const cy = Math.max(10, Math.min(screenH - 10, normY * screenH));

    handCursor.classList.add('visible');
    handCursor.style.left = `${cx}px`;
    handCursor.style.top = `${cy}px`;

    // 1. Palm Close (Fist) Toggle Door Gesture
    if (isPalmClose) {
      handCursor.classList.add('palm-close');
      handCursor.classList.remove('pinching');
      cursorBadge.textContent = 'PALM CLOSE';

      const now = Date.now();
      if (now - lastPalmToggleTime > 1200) {
        lastPalmToggleTime = now;
        toggleDoor();
      }
      return;
    } else {
      handCursor.classList.remove('palm-close');
    }

    // 2. Pinch Drag Gesture
    const prevPinching = isHandPinching;
    isHandPinching = isPinching;

    if (isPinching) {
      handCursor.classList.add('pinching');
      cursorBadge.textContent = 'PINCH';

      // Start pinch
      if (!prevPinching && !dragged) {
        const below = document.elementFromPoint(cx, cy);
        const foodCandidate = below?.closest('.food');
        const doorCandidate = below?.closest('#door');
        const closeCandidate = below?.closest('#close-door');

        if (doorCandidate && !fridge.classList.contains('open')) {
          toggleDoor();
        } else if (closeCandidate) {
          setDoor(false);
        } else if (foodCandidate) {
          startDrag({
            currentTarget: foodCandidate,
            x: cx,
            y: cy,
          });
        }
      } else if (dragged) {
        updateDragPos(cx, cy);
      }
    } else {
      handCursor.classList.remove('pinching');
      cursorBadge.textContent = gestureLabel || 'POINT';

      // Release pinch
      if (prevPinching && dragged) {
        finishDrag(cx, cy);
      }
    }
  };

  window.hideHandCursor = function () {
    handCursor.classList.remove('visible', 'pinching', 'palm-close');
    if (dragged) {
      cleanupDrag();
    }
  };

  // Populate files from Python (Max 9)
  window.setFridgeFiles = function (filesList, warningMsg) {
    if (warningMsg) {
      showToast(warningMsg, 4000);
    }
    fridgeFoods = new Array(9).fill(null);
    for (let i = 0; i < Math.min(9, filesList.length); i++) {
      fridgeFoods[i] = filesList[i];
    }
    renderShelves();
  };

  // Keyboard shortcut Esc / Q
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q') {
      if (window.pyBridge && window.pyBridge.closeApp) {
        window.pyBridge.closeApp();
      }
    }
  });
})();

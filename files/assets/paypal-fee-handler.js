/**
 * PAYPAL FEE HANDLER
 * Gestione commissione PayPal 3.5% per Softair Italia
 * 
 * Funzionalità:
 * - Checkbox "Pagherò con PayPal" nel carrello e mini-cart
 * - Banner informativo chiaro nella pagina prodotto
 * - Calcolo automatico 3.5% (arrotondato per eccesso)
 * - Ricalcolo automatico quando carrello cambia
 * - Rimozione automatica se carrello vuoto
 */

(function initPayPalFeeHandler() {
  'use strict';

  // Aspetta che window.routes e window.theme siano definiti prima di inizializzare
  // Questo evita l'errore "Cannot read properties of undefined"
  if (!window.routes || !window.theme) {
    // Se routes o theme non esistono, aspetta 50ms e riprova
    setTimeout(initPayPalFeeHandler, 50);
    return;
  }

  // CONFIGURAZIONE
  const CONFIG = {
    PAYPAL_FEE_SKU: 'PAYPAL-FEE-3-5',
    FEE_PERCENTAGE: 0.035, // 3.5%
    PAYPAL_FEE_VARIANT_ID: 52038356861271, // ID variante prodotto "Commissione PayPal 3.5%"
    SESSION_KEY_ADDED: 'paypal_fee_selected',
    SESSION_KEY_DECLINED: 'paypal_fee_declined'
  };
  
  // LOGICA INTELLIGENTE PER IL COUNT
  // Se spunta PayPal attiva → escludi sempre la commissione dal count
  // Se spunta PayPal non attiva → usa il count normale
  
  // RIMOSSO - Il server già calcola il count corretto
  // Se PayPal attivo, JavaScript NON deve toccare NULLA

  // UTILITY FUNCTIONS
  const Utils = {
    // Formatta prezzo in euro
    formatMoney: function(cents) {
      const euros = (cents / 100).toFixed(2);
      return euros.replace('.', ',') + ' €';
    },

    // Calcola 3.5% arrotondato per eccesso
    calculateFee: function(subtotalCents) {
      return Math.ceil(subtotalCents * CONFIG.FEE_PERCENTAGE);
    },

    // Ottieni carrello corrente
    getCart: async function() {
      try {
        const response = await fetch('/cart.js');
        return await response.json();
      } catch (error) {
        console.error('Errore recupero carrello:', error);
        return null;
      }
    },

    // Calcola subtotale escludendo commissione PayPal
    getSubtotalWithoutFee: function(cart) {
      let subtotal = 0;
      cart.items.forEach(item => {
        if (item.sku !== CONFIG.PAYPAL_FEE_SKU) {
          subtotal += item.final_line_price;
        }
      });
      return subtotal;
    },

    // Calcola il numero di articoli visualizzabile (esclude commissione)
    getAdjustedItemCount: function(cart) {
      let count = 0;
      cart.items.forEach(item => {
        if (item.sku !== CONFIG.PAYPAL_FEE_SKU) {
          count += item.quantity;
        }
      });
      return count;
    },

    // Trova line item commissione PayPal
    findFeeLineItem: function(cart) {
      return cart.items.find(item => item.sku === CONFIG.PAYPAL_FEE_SKU);
    },

    // Mostra loader
    showLoader: function(message = 'Aggiornamento in corso...') {
      const loader = document.createElement('div');
      loader.id = 'paypal-fee-loader';
      loader.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 99999; display: flex; align-items: center; justify-content: center;">
          <div style="background: white; padding: 30px; border-radius: 12px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
            <div style="font-size: 40px; margin-bottom: 15px;">⏳</div>
            <div style="font-size: 16px; color: #424242;">${message}</div>
          </div>
        </div>
      `;
      document.body.appendChild(loader);
    },

    // Nascondi loader
    hideLoader: function() {
      const loader = document.getElementById('paypal-fee-loader');
      if (loader) loader.remove();
    }
  };

  // CART API FUNCTIONS
  const CartAPI = {
    // Aggiungi prodotto commissione
    addFee: async function(feeAmount) {
      // console.log('Aggiunta commissione:', Utils.formatMoney(feeAmount));
      
      if (!CONFIG.PAYPAL_FEE_VARIANT_ID) {
        alert('ERRORE: Variant ID commissione PayPal non configurato. Contatta l\'assistenza.');
        return false;
      }

      try {
        // IMPORTANTE: Il prodotto commissione ha prezzo €0.01 nel backend
        // La quantità rappresenta i centesimi (es: 350 = €3.50)
        const quantityInCents = Math.round(feeAmount); // feeAmount è già in centesimi
        
        console.log('💳 Aggiunta commissione PayPal:', {
          feeAmountCents: feeAmount,
          quantity: quantityInCents,
          totalDisplay: Utils.formatMoney(feeAmount),
          variantId: CONFIG.PAYPAL_FEE_VARIANT_ID
        });
        
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            items: [{
              id: CONFIG.PAYPAL_FEE_VARIANT_ID,
              quantity: quantityInCents, // Quantità = centesimi (es: 350 per €3.50)
              properties: {
                '_paypal_fee': 'true',
                'Nota': 'La quantità mostrata rappresenta i centesimi dell\'importo (es: 350 = €3.50)'
              }
            }]
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('Errore aggiunta commissione:', errorData);
          
          // Messaggio specifico per problemi di inventario
          if (errorData.description && errorData.description.includes('out of stock')) {
            alert('Il prodotto commissione PayPal non è disponibile. Contatta l\'assistenza.');
          }
          
          throw new Error('Errore aggiunta commissione');
        }

        const updated = await response.json();
        await this.refreshCartUI();
        return updated;
      } catch (error) {
        console.error('Errore addFee:', error);
        return false;
      }
    },

    // Rimuovi commissione PayPal
    removeFee: async function() {
      // console.log('Rimozione commissione PayPal');
      
      const cart = await Utils.getCart();
      if (!cart) return false;

      const feeLineItem = Utils.findFeeLineItem(cart);
      if (!feeLineItem) {
        // console.log('Nessuna commissione da rimuovere');
        return true;
      }

      const lineIndex = cart.items.indexOf(feeLineItem) + 1;

      try {
        const response = await fetch('/cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            line: lineIndex,
            quantity: 0
          })
        });

        if (!response.ok) {
          throw new Error('Errore rimozione commissione');
        }

        return true;
      } catch (error) {
        console.error('Errore removeFee:', error);
        return false;
      }
    },

    // Aggiorna commissione (rimuove e riaggiungi con nuovo importo)
    updateFee: async function() {
      const cart = await Utils.getCart();
      if (!cart) return false;
      
      const subtotal = Utils.getSubtotalWithoutFee(cart);
      
      console.log('🔍 DEBUG updateFee:', {
        subtotal: subtotal,
        subtotalEuro: (subtotal / 100).toFixed(2),
        percentuale: CONFIG.FEE_PERCENTAGE,
        feeCalcolata: Math.ceil(subtotal * CONFIG.FEE_PERCENTAGE),
        feeEuro: (Math.ceil(subtotal * CONFIG.FEE_PERCENTAGE) / 100).toFixed(2)
      });
      
      // Se carrello vuoto (solo commissione o niente), rimuovi
      if (subtotal === 0) {
        await this.removeFee();
        return false;
      }

      const feeAmount = Utils.calculateFee(subtotal);
      const desiredQuantity = Math.round(feeAmount);
      const existingFee = Utils.findFeeLineItem(cart);

      // Se già corretta, non fare nulla
      if (existingFee && existingFee.quantity === desiredQuantity) {
        return true;
      }

      // Se esiste, aggiorna la quantità; altrimenti aggiungi
      if (existingFee) {
        await this.setFeeQuantity(existingFee.key, desiredQuantity);
      } else {
        await this.addFee(feeAmount);
      }

      return true;
    },

    // Imposta la quantità del prodotto commissione (in centesimi)
    setFeeQuantity: async function(lineItemKey, quantityInCents) {
      try {
        const response = await fetch('/cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ id: lineItemKey, quantity: quantityInCents })
        });
        if (!response.ok) {
          throw new Error('Errore aggiornamento quantità commissione');
        }
        const updatedCart = await response.json();
        await this.refreshCartUI();
        return updatedCart;
      } catch (e) {
        console.error('Errore setFeeQuantity:', e);
        return false;
      }
    },

    // Refresh UI del carrello sostituendo la sezione senza ricaricare la pagina
    refreshCartUI: async function() {
      try {
        const cartSection = document.querySelector('section[data-section-type="cart"]');
        if (!cartSection) {
          window.location.reload();
          return;
        }
        
        // NESSUN overlay opaco - refresh silenzioso
        
        const sectionId = cartSection.getAttribute('data-section-id');
        const response = await fetch(`/cart?section_id=${sectionId}`);
        if (!response.ok) {
          window.location.reload();
          return;
        }
        const html = await response.text();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        const freshSection = wrapper.querySelector(`section[data-section-id="${sectionId}"]`);
        if (freshSection) {
          // Sostituzione immediata senza transizioni
          cartSection.replaceWith(freshSection);
          
          // Riattacca i listeners
          CheckboxHandler.init();
          // RIMOSSO HeaderCartCount.update() - Il count è già corretto dal server
          // Non serve re-inizializzare RemoveFeeHandler perché usa event delegation sul document
        } else {
          window.location.reload();
        }
      } catch (e) {
        window.location.reload();
      }
    }
  };

  // SINCRONIZZAZIONE IMMEDIATA CHECKBOX
  // Applica lo stato saved della checkbox appena possibile
  function syncCheckboxFromStorage() {
    const shouldBeChecked = sessionStorage.getItem(CONFIG.SESSION_KEY_ADDED) === 'true';
    if (shouldBeChecked) {
      const mainCheckbox = document.getElementById('paypal-fee-checkbox-main');
      const drawerCheckbox = document.getElementById('paypal-fee-checkbox-drawer');
      if (mainCheckbox) mainCheckbox.checked = true;
      if (drawerCheckbox) drawerCheckbox.checked = true;
    }
  }
  
  // Esegui appena possibile
  syncCheckboxFromStorage();

  // CHECKBOX HANDLER
  const CheckboxHandler = {
    init: function() {
      // console.log('Inizializzazione checkbox handler');
      
      // Checkbox nel carrello principale
      const mainCheckbox = document.getElementById('paypal-fee-checkbox-main');
      if (mainCheckbox) {
        // Sincronizza stato PRIMA di clonare
        const shouldBeChecked = sessionStorage.getItem(CONFIG.SESSION_KEY_ADDED) === 'true';
        mainCheckbox.checked = shouldBeChecked;
        
        // Rimuovi listener esistenti clonando l'elemento
        const newMainCheckbox = mainCheckbox.cloneNode(true);
        newMainCheckbox.checked = shouldBeChecked; // Mantieni lo stato anche nel clone
        mainCheckbox.parentNode.replaceChild(newMainCheckbox, mainCheckbox);
        newMainCheckbox.addEventListener('change', this.handleCheckboxChange.bind(this));
      }

      // Checkbox nel mini-cart
      const drawerCheckbox = document.getElementById('paypal-fee-checkbox-drawer');
      if (drawerCheckbox) {
        // Sincronizza stato PRIMA di clonare
        const shouldBeChecked = sessionStorage.getItem(CONFIG.SESSION_KEY_ADDED) === 'true';
        drawerCheckbox.checked = shouldBeChecked;
        
        // Rimuovi listener esistenti clonando l'elemento
        const newDrawerCheckbox = drawerCheckbox.cloneNode(true);
        newDrawerCheckbox.checked = shouldBeChecked; // Mantieni lo stato anche nel clone
        drawerCheckbox.parentNode.replaceChild(newDrawerCheckbox, drawerCheckbox);
        newDrawerCheckbox.addEventListener('change', this.handleCheckboxChange.bind(this));
      }

      // Checkbox nella pagina prodotto
      const productCheckbox = document.getElementById('paypal-fee-checkbox-product');
      if (productCheckbox) {
        // Sincronizza stato PRIMA di clonare
        const shouldBeChecked = sessionStorage.getItem(CONFIG.SESSION_KEY_ADDED) === 'true';
        productCheckbox.checked = shouldBeChecked;
        
        // Rimuovi listener esistenti clonando l'elemento
        const newProductCheckbox = productCheckbox.cloneNode(true);
        newProductCheckbox.checked = shouldBeChecked; // Mantieni lo stato anche nel clone
        productCheckbox.parentNode.replaceChild(newProductCheckbox, productCheckbox);
        newProductCheckbox.addEventListener('change', this.handleProductCheckboxChange.bind(this));
      }

      // Ricalcolo dinamico quando cambiano le quantità nel carrello
      const scheduleRecalc = () => {
        window.clearTimeout(this._recalcTimer);
        this._recalcTimer = window.setTimeout(async () => {
          const cart = await Utils.getCart();
          if (!cart) return;
          const hasFee = Utils.findFeeLineItem(cart);
          const userWantsFee = sessionStorage.getItem(CONFIG.SESSION_KEY_ADDED) === 'true';
          if (hasFee || userWantsFee) {
            await CartAPI.updateFee();
            await CartAPI.refreshCartUI();
          }
          // RIMOSSO - Il count è già corretto dal server
        }, 600);
      };

      document.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="increase-quantity"], [data-action="decrease-quantity"], .line-item__quantity-remove')) {
          scheduleRecalc();
        }
      }, true);

      document.addEventListener('change', (e) => {
        if (e.target.matches('.quantity-selector__value')) {
          scheduleRecalc();
        }
      }, true);

      document.addEventListener('input', (e) => {
        if (e.target.matches('.quantity-selector__value')) {
          scheduleRecalc();
        }
      }, true);

      // Controlla se carrello vuoto all'avvio
      this.checkEmptyCart();
    },

    handleCheckboxChange: async function(e) {
      const isChecked = e.target.checked;
      const checkbox = e.target;

      // Disabilita checkbox durante operazione
      checkbox.disabled = true;

      // Mostra loader
      Utils.showLoader(isChecked ? 'Aggiunta commissione PayPal...' : 'Rimozione commissione...');

      // Salva lo stato immediatamente
      if (isChecked) {
        sessionStorage.setItem(CONFIG.SESSION_KEY_ADDED, 'true');
        sessionStorage.removeItem(CONFIG.SESSION_KEY_DECLINED);
      } else {
        sessionStorage.removeItem(CONFIG.SESSION_KEY_ADDED);
      }
      
      // Emetti evento per aggiornare il count
      document.dispatchEvent(new CustomEvent('paypal-fee-changed'));
      
      // Il count viene corretto automaticamente dal theme.liquid

      try {
        if (isChecked) {
          // Aggiungi commissione
          const cart = await Utils.getCart();
          const subtotal = Utils.getSubtotalWithoutFee(cart);
          const feeAmount = Utils.calculateFee(subtotal);
          
          await CartAPI.addFee(feeAmount);
        } else {
          // Rimuovi commissione
          await CartAPI.removeFee();
        }

        // RIMOSSO - Il count è già corretto dal server
        
        // Reload con loader visibile
        window.location.reload();

      } catch (error) {
        Utils.hideLoader();
        console.error('Errore gestione checkbox:', error);
        alert('Errore durante l\'aggiornamento. Ricarica la pagina.');
        checkbox.checked = !isChecked;
        checkbox.disabled = false;
        if (isChecked) {
          sessionStorage.removeItem(CONFIG.SESSION_KEY_ADDED);
        } else {
          sessionStorage.setItem(CONFIG.SESSION_KEY_ADDED, 'true');
        }
      }
    },

    handleProductCheckboxChange: function(e) {
      const isChecked = e.target.checked;
      
      // Salva lo stato in sessionStorage (sarà usato quando si aggiunge al carrello)
      if (isChecked) {
        sessionStorage.setItem(CONFIG.SESSION_KEY_ADDED, 'true');
        sessionStorage.removeItem(CONFIG.SESSION_KEY_DECLINED);
      } else {
        sessionStorage.removeItem(CONFIG.SESSION_KEY_ADDED);
      }
      
      // Sincronizza con altre checkbox se esistono
      const mainCheckbox = document.getElementById('paypal-fee-checkbox-main');
      const drawerCheckbox = document.getElementById('paypal-fee-checkbox-drawer');
      
      if (mainCheckbox) mainCheckbox.checked = isChecked;
      if (drawerCheckbox) drawerCheckbox.checked = isChecked;
    },

    syncCheckboxState: async function(checkbox) {
      // Verifica se commissione è già nel carrello
      const cart = await Utils.getCart();
      if (!cart) return;

      const hasFee = Utils.findFeeLineItem(cart) !== undefined;
      checkbox.checked = hasFee;

      // Salva in sessionStorage
      if (hasFee) {
        sessionStorage.setItem(CONFIG.SESSION_KEY_ADDED, 'true');
      }
    },

    checkEmptyCart: async function() {
      const cart = await Utils.getCart();
      if (!cart) return;

      const subtotal = Utils.getSubtotalWithoutFee(cart);

      // Se carrello vuoto (o solo commissione), rimuovi commissione e deselezione checkbox
      if (subtotal === 0) {
        await CartAPI.removeFee();
        
        const mainCheckbox = document.getElementById('paypal-fee-checkbox-main');
        const drawerCheckbox = document.getElementById('paypal-fee-checkbox-drawer');
        
        if (mainCheckbox) mainCheckbox.checked = false;
        if (drawerCheckbox) drawerCheckbox.checked = false;

        sessionStorage.removeItem(CONFIG.SESSION_KEY_ADDED);
      }
    }
  };

  // PAYPAL EXPRESS HANDLER - RIMOSSO
  // Non più necessario grazie al banner informativo chiaro nella pagina prodotto

  // ADD TO CART: resta nella pagina (comportamento tipo drawer) senza toccare altre logiche
  const AddToCartNoRedirect = {
    attached: false,

    init: function() {
      if (!window.theme || window.theme.cartType !== 'page') return;
      if (this.attached) return;
      this.attached = true;

      // Intercetta submit dei form /cart/add (fase di cattura)
      document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!form || form.tagName !== 'FORM') return;
        const action = (form.getAttribute('action') || '');
        if (!/\/cart\/add/.test(action)) return;

        e.preventDefault();
        this.ajaxAdd(form);
      }, true);

      // Intercetta click sul bottone Aggiungi (in caso di handler del tema)
      document.addEventListener('click', (e) => {
        const button = e.target && e.target.closest('button[name="add"], .product-form__add-button, [type="submit"][name="add"]');
        if (!button) return;
        const form = button.closest('form');
        if (!form) return;
        const action = (form.getAttribute('action') || '');
        if (!/\/cart\/add/.test(action)) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        this.ajaxAdd(form, button);
      }, true);
    },

    ajaxAdd: function(form, button) {
      const formData = new FormData(form);

      const originalText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        try { button.textContent = 'Aggiunta in corso...'; } catch (_) {}
      }

      fetch('/cart/add.js', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(async () => {
          // Se checkbox PayPal attiva nella pagina prodotto, aggiungi commissione
          const userWantsFee = sessionStorage.getItem(CONFIG.SESSION_KEY_ADDED) === 'true';
          if (userWantsFee) {
            try {
              const cart = await Utils.getCart();
              const subtotal = Utils.getSubtotalWithoutFee(cart);
              const feeAmount = Utils.calculateFee(subtotal);
              await CartAPI.addFee(feeAmount);
            } catch (error) {
              console.error('Errore aggiunta commissione PayPal:', error);
            }
          }
          
          // Notifica il tema che il carrello è cambiato
          document.dispatchEvent(new Event('cart:updated'));
        })
        .catch(() => {})
        .finally(() => {
          if (button) {
            try { button.textContent = originalText; } catch (_) {}
            button.disabled = false;
          }
        });
    }
  };

  // INIZIALIZZAZIONE
  function init() {
    // Aspetta che DOM sia pronto
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        CheckboxHandler.init();
      });
    } else {
      CheckboxHandler.init();
    }

    // Listener per aggiornamenti carrello
    document.addEventListener('cart:updated', async () => {
      CheckboxHandler.checkEmptyCart();
      const cart = await Utils.getCart();
      if (!cart) return;
      const hasFee = Utils.findFeeLineItem(cart);
      const userWantsFee = sessionStorage.getItem(CONFIG.SESSION_KEY_ADDED) === 'true';
      if (hasFee || userWantsFee) {
        await CartAPI.updateFee();
        await CartAPI.refreshCartUI();
      }
    });

    // Garantisce che la commissione sia allineata al subtotale attuale
    (async () => {
      const cart = await Utils.getCart();
      if (!cart) return;
      const hasFee = !!Utils.findFeeLineItem(cart);
      const userSelected = sessionStorage.getItem(CONFIG.SESSION_KEY_ADDED) === 'true';
      if (hasFee || userSelected) {
        await CartAPI.updateFee();
      }
    })();
  }

  // Esporta per uso globale
  window.PayPalFeeHandler = {
    config: CONFIG,
    utils: Utils,
    cartAPI: CartAPI,
    init: init
  };

  // Auto-init
  init();

  // RIMOSSO - La correzione count è ora gestita globalmente in theme.liquid
  // Si applica automaticamente a tutte le pagine

  // GESTIONE RIMOZIONE COMMISSIONE PAYPAL CON MODAL CUSTOM
  const RemoveFeeHandler = {
    modalElement: null,

    init: function() {
      this.createModal();
      document.addEventListener('click', this.handleRemoveClick.bind(this));
    },

    createModal: function() {
      // Crea il modal HTML
      const modalHTML = `
        <div class="paypal-fee-modal-overlay" id="paypal-fee-remove-modal">
          <div class="paypal-fee-modal">
            <div class="paypal-fee-modal__header">
              <span class="paypal-fee-modal__icon">⚠️</span>
              <h3 class="paypal-fee-modal__title">Rimuovere Commissione PayPal?</h3>
            </div>
            <div class="paypal-fee-modal__body">
              <p class="paypal-fee-modal__message">
                Stai per rimuovere la commissione PayPal dal carrello.<br>
                Questo significa che <strong>NON pagherai con PayPal</strong>.
              </p>
              <div class="paypal-fee-modal__warning">
                <p class="paypal-fee-modal__warning-text">
                  ⚠️ IMPORTANTE: Gli ordini PayPal senza commissione NON verranno processati.
                </p>
              </div>
            </div>
            <div class="paypal-fee-modal__footer">
              <button class="paypal-fee-modal__button paypal-fee-modal__button--cancel" data-modal-cancel>
                Annulla
              </button>
              <button class="paypal-fee-modal__button paypal-fee-modal__button--confirm" data-modal-confirm>
                Conferma Rimozione
              </button>
            </div>
          </div>
        </div>
      `;

      // Aggiungi al body
      document.body.insertAdjacentHTML('beforeend', modalHTML);
      this.modalElement = document.getElementById('paypal-fee-remove-modal');

      // Event listeners per i pulsanti del modal
      this.modalElement.querySelector('[data-modal-cancel]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeConfirmModal();
      });
      this.modalElement.querySelector('[data-modal-confirm]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.confirmRemoval(e);
      });
      
      // Chiudi cliccando sull'overlay
      this.modalElement.addEventListener('click', (e) => {
        if (e.target === this.modalElement) {
          this.closeConfirmModal();
        }
      });

      // Chiudi con ESC
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.modalElement.classList.contains('active')) {
          this.closeConfirmModal();
        }
      });
    },

    handleRemoveClick: function(e) {
      const removeLink = e.target.closest('[data-paypal-fee-remove]');
      if (!removeLink) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.showConfirmModal();
    },

    showConfirmModal: function() {
      if (this.modalElement) {
        this.modalElement.classList.add('active');
        document.body.style.overflow = 'hidden'; // Blocca scroll
      }
    },

    closeConfirmModal: function() {
      if (this.modalElement) {
        this.modalElement.classList.remove('active');
        document.body.style.overflow = ''; // Ripristina scroll
      }
    },

    confirmRemoval: async function(e) {
      console.log('🗑️ Rimozione commissione PayPal confermata dall\'utente');

      // Previeni qualsiasi comportamento default
      if (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }

      // Chiudi il modal di conferma
      this.closeConfirmModal();

      // Rimuovi la commissione
      await CartAPI.removeFee();

      // Disattiva la checkbox
      const checkboxes = document.querySelectorAll('#paypal-fee-checkbox, #paypal-fee-checkbox-drawer');
      checkboxes.forEach(cb => {
        cb.checked = false;
      });

      // Rimuovi flag da sessione
      sessionStorage.removeItem(CONFIG.SESSION_KEY_ADDED);

      // Refresh UI senza redirect
      await CartAPI.refreshCartUI();
      
      // Assicurati di rimanere sulla pagina corrente
      return false;
    }
  };

  // Inizializzazione quando DOM è pronto
  function initializeAll() {
    // Inizializza handler rimozione (sempre)
    RemoveFeeHandler.init();

    // Inizializzazione generale
    init();

    // Forza il comportamento del tema come "drawer" senza toccare altro
    try {
      if (window.theme && window.theme.cartType === 'page') {
        window.theme.cartType = 'drawer';
      }
    } catch (_) {}

    // Abilita comportamento "tipo drawer" (resta nella pagina) senza toccare altre logiche (fallback se il tema resta su page)
    AddToCartNoRedirect.init();
  }

  // Se il DOM è già pronto, inizializza subito
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAll);
  } else {
    initializeAll();
  }

})();


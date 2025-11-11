const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const ordersSection = document.querySelector('#orders-section');
const ordersList = document.querySelector('#orders-list');

async function fetchOrders() {
  try {
    const response = await fetch('/api/orders');
    if (!response.ok) {
      throw new Error('Aufträge konnten nicht geladen werden.');
    }
    const data = await response.json();
    renderOrders(data.orders || []);
  } catch (error) {
    loginMessage.textContent = error.message;
  }
}

function renderOrders(orders) {
  ordersSection.hidden = false;
  ordersList.innerHTML = '';
  if (orders.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Keine Aufträge gefunden.';
    ordersList.appendChild(li);
    return;
  }
  for (const order of orders) {
    const li = document.createElement('li');
    li.innerHTML = `
      <article class="order">
        <h3>${order.name}</h3>
        <p><strong>Board:</strong> ${order.boardId}</p>
        <p><strong>Status:</strong> ${order.status || 'unbekannt'}</p>
      </article>
    `;
    ordersList.appendChild(li);
  }
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginMessage.textContent = '';
    const formData = new FormData(loginForm);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Anmeldung fehlgeschlagen.');
      }
      loginForm.hidden = true;
      loginMessage.textContent = `Willkommen ${data.user.email}`;
      fetchOrders();
    } catch (error) {
      loginMessage.textContent = error.message;
    }
  });
}

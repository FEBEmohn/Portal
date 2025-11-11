const createAccountForm = document.querySelector('#create-account-form');
const accountsTableBody = document.querySelector('#accounts-table tbody');
const accountMessage = document.querySelector('#account-message');

async function loadAccounts() {
  try {
    const response = await fetch('/api/admin/accounts');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Konten konnten nicht geladen werden.');
    }
    renderAccounts(data.accounts || []);
  } catch (error) {
    accountMessage.textContent = error.message;
  }
}

function renderAccounts(accounts) {
  accountsTableBody.innerHTML = '';
  if (accounts.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'Keine Konten vorhanden.';
    row.appendChild(cell);
    accountsTableBody.appendChild(row);
    return;
  }

  for (const account of accounts) {
    const row = document.createElement('tr');
    const emailCell = document.createElement('td');
    emailCell.textContent = account.email;
    const itemCell = document.createElement('td');
    itemCell.textContent = account.mondayItemId;
    const createdCell = document.createElement('td');
    const created = account.createdAt ? new Date(account.createdAt) : null;
    createdCell.textContent = created ? created.toLocaleString('de-DE') : '–';

    row.appendChild(emailCell);
    row.appendChild(itemCell);
    row.appendChild(createdCell);

    accountsTableBody.appendChild(row);
  }
}

if (createAccountForm) {
  createAccountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    accountMessage.textContent = '';
    const formData = new FormData(createAccountForm);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Konto konnte nicht angelegt werden.');
      }
      createAccountForm.reset();
      accountMessage.textContent = 'Konto erfolgreich erstellt.';
      loadAccounts();
    } catch (error) {
      accountMessage.textContent = error.message;
    }
  });

  loadAccounts();
}

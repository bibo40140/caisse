// dev-test-login.js
async function main() {
  const email = 'fabien.hicauber@gmail.com';
  const password = 'admin123!';

  console.log('Test login avec :', email, password);

  const res = await fetch('http://localhost:3001/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const js = await res.json().catch(() => ({}));
  console.log('Status HTTP =', res.status);
  console.log('Réponse JSON =', js);
}

main().catch(err => {
  console.error('Erreur dev-test-login:', err);
});

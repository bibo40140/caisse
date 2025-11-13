async function main() {
  const email = 'fabien.hicauber@gmail.com';
  const password = 'admin123!';

  console.log('On enregistre le tenant avec :', email, password);

  const res = await fetch('http://localhost:3001/auth/register-tenant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      tenant_name: 'Coopaz Dev',
      email,
      password,
      company_name: 'Coopaz',
      logo_url: null,
    }),
  });

  const js = await res.json().catch(() => ({}));
  console.log('Status HTTP =', res.status);
  console.log('Réponse JSON =', js);
}

main().catch(err => {
  console.error('Erreur dev-register-tenant:', err);
});

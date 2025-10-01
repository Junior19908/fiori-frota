Firebase Storage: bucket, regras e CORS
=================================================

1) Identifique o bucket correto

- No Console do Firebase → Storage → topo da tela mostra o bucket atual.
- Use exatamente esse nome em `webapp/services/settings/firebaseConfig.js` no campo `storageBucket`.
- Para este projeto (conforme screenshot): `sistemagsg.firebasestorage.app`.

2) Regras (DEV) para leitura dos JSONs

- Para o SDK `getDownloadURL` funcionar em ambiente sem login, permita leitura do prefixo `abastecimentos/**`:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /abastecimentos/{year}/{month}/{file} {
      allow read: if true;    // DEV apenas. Em produção, restrinja por Auth.
    }
  }
}
```

- Publique as regras no Console (Storage → Regras → Publicar).

3) CORS no bucket

- Aplique CORS no bucket identificado acima. Na raiz do repo há um `cors.json` com origens `http://localhost:8080` e `8081`.
- Pré-requisito: Google Cloud SDK instalado e autenticado (`gcloud auth login`).

PowerShell:

```
scripts\apply-cors.ps1 -Bucket "sistemagsg.firebasestorage.app" -CorsFile "cors.json"
```

Ou diretamente:

```
gsutil cors set cors.json gs://sistemagsg.firebasestorage.app
```

4) Teste

- Rode o app (`npm start`).
- No DevTools → Network, verifique que o GET dos JSONs retorna `Access-Control-Allow-Origin` para `http://localhost:8080`.
- Se ainda estiver ajustando CORS/regras, abra a app com `?useLocalAbastecimentos=1` para consumir `webapp/model/localdata/.../abastecimentos.json`.

Notas

- Se preferir não abrir leitura pública, habilite Auth no app e troque as regras para `allow read: if request.auth != null;`. A app deve autenticar antes de chamar o Storage.
- O método `getDownloadURL` falha se as regras bloquearem leitura de metadados; por isso a leitura pública (somente leitura) do prefixo simplifica o uso.


-- Atualização 25: libera XML no bucket 'recebimentos'
--
-- O bucket foi criado pelo painel com allowed_mime_types restrito a PDF e
-- imagens (anexo de nota fiscal digitalizada). A importação de NF-e por XML
-- (atualização 22) grava o arquivo no mesmo bucket e batia em
-- "mime type application/xml is not supported".
--
-- text/xml entra junto porque alguns clientes/navegadores rotulam o mesmo
-- arquivo com esse tipo, e o limite de 10 MB do bucket já cobre a NF-e (o
-- endpoint de upload recusa XML acima de 2 MB antes de chegar aqui).

update storage.buckets
   set allowed_mime_types = array[
         'application/pdf',
         'image/jpeg',
         'image/png',
         'image/webp',
         'image/heic',
         'application/xml',
         'text/xml'
       ]
 where id = 'recebimentos';

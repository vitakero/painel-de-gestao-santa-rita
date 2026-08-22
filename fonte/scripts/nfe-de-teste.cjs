// Gera arquivos XML de NF-e para TESTAR o Portal do Fornecedor.
//
// ISTO NÃO É NOTA FISCAL. É arquivo de teste, montado por este script para
// exercitar a leitura do portal. Não tem valor fiscal, não foi autorizado pela
// Receita, e o número de protocolo é inventado. Serve só para conferir se o
// sistema lê, aceita e recusa o que deve.
//
// Por que existe: até agora os testes usavam exemplos escritos dentro do
// próprio teste. Ter arquivo de verdade, que dá pra arrastar na tela, é o que
// permite provar o caminho inteiro — do arrastar até aparecer no comprovante.
//
// Gera três, e cada um prova uma coisa:
//   1. normal        — deve ser ACEITO e mostrar 3 produtos
//   2. grande        — deve ser ACEITO e mostrar 40 produtos (testa a tela cheia)
//   3. outra-empresa — deve ser RECUSADO: destinatário não é o Santa Rita
//
// O terceiro é tão importante quanto os outros: sistema que só aceita não
// está conferindo nada.
//
//   node scripts/nfe-de-teste.cjs
const fs = require("fs");
const path = require("path");

const SAIDA = path.join(process.env.HOME, "vr-looker-integration", ".previa", "nfe-teste");

const SANTA_RITA = { cnpj: "12988127000140", nome: "SUPERMERCADO SANTA RITA LTDA",
                     ie: "204567890", mun: "2402006", cmun: "CAICO", uf: "RN",
                     rua: "RUA ANDRE SALES", num: "531", bairro: "PAULO VI", cep: "59300000" };

const FORNECEDOR = { cnpj: "20947638000141", nome: "G J DOS SANTOS E FILHOS LTDA",
                     fantasia: "GJ DISTRIBUIDORA", ie: "205551234", mun: "2408102",
                     cmun: "NATAL", uf: "RN", rua: "AV INDUSTRIAL NORTE", num: "1200",
                     bairro: "DISTRITO INDUSTRIAL", cep: "59280000" };

const OUTRA_LOJA = { cnpj: "07526557000100", nome: "OUTRO SUPERMERCADO LTDA",
                     ie: "112233445", mun: "2408102", cmun: "NATAL", uf: "RN",
                     rua: "RUA QUALQUER", num: "10", bairro: "CENTRO", cep: "59000000" };

// ---------------------------------------------------------------
// A chave de 44 números e o dígito que fecha a conta
// ---------------------------------------------------------------
function digito(base43) {
  let peso = 2, soma = 0;
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += parseInt(base43.charAt(i), 10) * peso;
    peso++; if (peso > 9) peso = 2;
  }
  const r = soma % 11;
  return (r === 0 || r === 1) ? 0 : 11 - r;
}
function montarChave(uf, aamm, cnpj, mod, serie, numero, cNF) {
  const base = String(uf) + aamm + cnpj + mod +
               String(serie).padStart(3, "0") +
               String(numero).padStart(9, "0") + "1" +
               String(cNF).padStart(8, "0");
  return base + digito(base);
}

const PRODUTOS = [
  ["7891000100103", "LEITE INTEGRAL CX 1L - CAIXA C/12", "04012010", "CX", 120, 52.90],
  ["7894900011517", "REFRIGERANTE COLA 2L - FARDO C/6",  "22021000", "FD",  80, 38.50],
  ["7896005800010", "BISCOITO RECHEADO 140G - CX C/40",  "19053100", "CX", 200, 44.96],
  ["7891910000197", "ACUCAR REFINADO 1KG - FARDO C/10",  "17019900", "FD",  60, 41.20],
  ["7891149101009", "OLEO DE SOJA 900ML - CX C/20",      "15079011", "CX",  45, 96.00],
  ["7896036098943", "ARROZ TIPO 1 5KG - FARDO C/6",      "10063021", "FD",  90, 118.50],
  ["7891098010101", "FEIJAO CARIOCA 1KG - FARDO C/10",   "07133399", "FD",  70, 78.90],
  ["7891000053508", "CAFE TORRADO MOIDO 500G - CX C/20", "09012100", "CX",  35, 189.00],
  ["7896102500011", "MACARRAO ESPAGUETE 500G - CX C/20", "19021900", "CX",  50, 62.40],
  ["7891910000456", "SAL REFINADO 1KG - FARDO C/30",     "25010020", "FD",  25, 44.70],
];

function item(n, p) {
  const [ean, nome, ncm, un, qtd, unit] = p;
  const total = +(qtd * unit).toFixed(2);
  return `    <det nItem="${n}">
      <prod>
        <cProd>${String(1000 + n)}</cProd>
        <cEAN>${ean}</cEAN>
        <xProd>${nome}</xProd>
        <NCM>${ncm}</NCM>
        <CFOP>5102</CFOP>
        <uCom>${un}</uCom>
        <qCom>${qtd.toFixed(4)}</qCom>
        <vUnCom>${unit.toFixed(4)}</vUnCom>
        <vProd>${total.toFixed(2)}</vProd>
        <cEANTrib>${ean}</cEANTrib>
        <uTrib>${un}</uTrib>
        <qTrib>${qtd.toFixed(4)}</qTrib>
        <vUnTrib>${unit.toFixed(4)}</vUnTrib>
        <indTot>1</indTot>
        <!-- O PEDIDO DE COMPRA. É a etiqueta que o portal passou a ler para
             saber de que pedido é a entrega, sem o fornecedor digitar nada. -->
        <xPed>${45230 + (n % 3)}</xPed>
        <nItemPed>${n}</nItemPed>
      </prod>
      <imposto>
        <ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC>
          <vBC>${total.toFixed(2)}</vBC><pICMS>18.00</pICMS>
          <vICMS>${(total * 0.18).toFixed(2)}</vICMS></ICMS00></ICMS>
      </imposto>
    </det>`;
}

function endereco(e) {
  return `<xLgr>${e.rua}</xLgr><nro>${e.num}</nro><xBairro>${e.bairro}</xBairro>` +
         `<cMun>${e.mun}</cMun><xMun>${e.cmun}</xMun><UF>${e.uf}</UF>` +
         `<CEP>${e.cep}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais>`;
}

function montar(o) {
  // o ano e o mês da chave saem da própria data de emissão: dois lugares
  // com a mesma informação é convite para eles discordarem
  const aamm = o.data.slice(2, 4) + o.data.slice(5, 7);
  const chave = montarChave(24, aamm, FORNECEDOR.cnpj, "55", 1, o.numero, o.cNF);
  const itens = o.produtos.map((p, i) => item(i + 1, p)).join("\n");
  const totalProd = o.produtos.reduce((s, p) => s + p[4] * p[5], 0);
  const volumes = o.volumes, peso = o.peso;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide>
        <cUF>24</cUF><cNF>${String(o.cNF).padStart(8, "0")}</cNF>
        <natOp>VENDA DE MERCADORIA</natOp>
        <mod>55</mod><serie>1</serie><nNF>${o.numero}</nNF>
        <dhEmi>${o.data}T09:15:00-03:00</dhEmi>
        <tpNF>1</tpNF><idDest>1</idDest><cMunFG>${FORNECEDOR.mun}</cMunFG>
        <tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(43)}</cDV>
        <tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal>
        <indPres>0</indPres><procEmi>0</procEmi><verProc>TESTE-SANTA-RITA</verProc>
      </ide>
      <emit>
        <CNPJ>${FORNECEDOR.cnpj}</CNPJ>
        <xNome>${FORNECEDOR.nome}</xNome>
        <xFant>${FORNECEDOR.fantasia}</xFant>
        <enderEmit>${endereco(FORNECEDOR)}</enderEmit>
        <IE>${FORNECEDOR.ie}</IE><CRT>3</CRT>
      </emit>
      <dest>
        <CNPJ>${o.destino.cnpj}</CNPJ>
        <xNome>${o.destino.nome}</xNome>
        <enderDest>${endereco(o.destino)}</enderDest>
        <indIEDest>1</indIEDest><IE>${o.destino.ie}</IE>
      </dest>
${itens}
      <total>
        <ICMSTot>
          <vBC>${totalProd.toFixed(2)}</vBC>
          <vICMS>${(totalProd * 0.18).toFixed(2)}</vICMS>
          <vProd>${totalProd.toFixed(2)}</vProd>
          <vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>
          <vNF>${totalProd.toFixed(2)}</vNF>
        </ICMSTot>
      </total>
      <transp>
        <modFrete>0</modFrete>
        <transporta>
          <CNPJ>33444555000199</CNPJ>
          <xNome>TRANSPORTES CAICO LTDA</xNome>
          <IE>203334455</IE><xEnder>BR 427 KM 12</xEnder>
          <xMun>CAICO</xMun><UF>RN</UF>
        </transporta>
        <vol>
          <qVol>${volumes}</qVol><esp>PALLET</esp><marca>GJ</marca>
          <pesoL>${(peso * 0.95).toFixed(3)}</pesoL>
          <pesoB>${peso.toFixed(3)}</pesoB>
        </vol>
      </transp>
      <infAdic>
        <infCpl>ARQUIVO DE TESTE DO PORTAL DO FORNECEDOR - SUPERMERCADO SANTA RITA. NAO E DOCUMENTO FISCAL.</infCpl>
      </infAdic>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb><verAplic>TESTE</verAplic>
      <chNFe>${chave}</chNFe>
      <dhRecbto>${o.data}T09:20:00-03:00</dhRecbto>
      <nProt>124000000000000</nProt>
      <digVal>TESTE</digVal><cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;
  return { xml, chave, total: totalProd, itens: o.produtos.length };
}

// ---------------------------------------------------------------
const CASOS = [
  { arquivo: "1-nfe-normal.xml", numero: 990001, cNF: 90000001, data: "2026-08-10",
    destino: SANTA_RITA, produtos: PRODUTOS.slice(0, 3), volumes: 8, peso: 1240.5,
    esperado: "ACEITA — 3 produtos, 8 pallets, 1.240,5 kg" },

  { arquivo: "2-nfe-grande.xml", numero: 990002, cNF: 90000002, data: "2026-08-11",
    destino: SANTA_RITA,
    produtos: PRODUTOS.concat(PRODUTOS, PRODUTOS, PRODUTOS).slice(0, 40),
    volumes: 32, peso: 8750.25,
    esperado: "ACEITA — 40 produtos (testa a lista longa)" },

  { arquivo: "3-nfe-outra-empresa.xml", numero: 990003, cNF: 90000003, data: "2026-08-12",
    destino: OUTRA_LOJA, produtos: PRODUTOS.slice(0, 2), volumes: 4, peso: 380.0,
    esperado: "RECUSADA — nota emitida para outra empresa" },
];

fs.mkdirSync(SAIDA, { recursive: true });
console.log("ARQUIVOS DE TESTE (nao sao documentos fiscais)\n");
const resumo = [];
for (const c of CASOS) {
  const r = montar(c);
  fs.writeFileSync(path.join(SAIDA, c.arquivo), r.xml, "utf8");
  console.log("  " + c.arquivo);
  console.log("     " + c.esperado);
  console.log("     chave: " + r.chave);
  console.log("     valor: R$ " + r.total.toFixed(2).replace(".", ",") + "   itens: " + r.itens);
  console.log("");
  resumo.push({ arquivo: c.arquivo, chave: r.chave, esperado: c.esperado });
}
fs.writeFileSync(path.join(SAIDA, "LEIA-ME.txt"),
  "ARQUIVOS DE TESTE DO PORTAL DO FORNECEDOR\n" +
  "Supermercado Santa Rita - gerados por scripts/nfe-de-teste.cjs\n\n" +
  "ATENCAO: nao sao documentos fiscais. Nao tem valor legal, nao foram\n" +
  "autorizados pela Receita e o protocolo e inventado. Servem so para\n" +
  "testar se o portal le, aceita e recusa o que deve.\n\n" +
  resumo.map(r => r.arquivo + "\n  " + r.esperado + "\n  chave: " + r.chave).join("\n\n") + "\n",
  "utf8");
console.log("Pasta: " + SAIDA);

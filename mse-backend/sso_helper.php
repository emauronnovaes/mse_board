<?php
/**
 * Helper de SSO do MSE Board (lado "Super App" que RECEBE o token).
 *
 * Espelha o helper do Portal MSE que GERA o token. A estratégia é um token
 * curto assinado com HMAC-SHA256, passado na URL do iframe como ?sso=<token>.
 *
 * Formato do token (estilo JWT compacto, sem header):
 *   base64url(payload_json) + "." + base64url(hmac_sha256(secret, base64url(payload_json)))
 *
 * A chave secreta (SUPER_APP_SSO_SECRET) vem do arquivo .env e DEVE ser
 * idêntica à usada pelo portal que gera o token. Nunca é exposta ao navegador:
 * a validação acontece somente aqui, no servidor.
 */

require_once __DIR__ . '/config.php';

if (!defined('SUPER_APP_SSO_SECRET')) {
    define('SUPER_APP_SSO_SECRET', (string) env('SUPER_APP_SSO_SECRET', ''));
}

if (!defined('SUPER_APP_SSO_TTL_SEGUNDOS')) {
    define('SUPER_APP_SSO_TTL_SEGUNDOS', (int) env('SUPER_APP_SSO_TTL_SEGUNDOS', 60));
}

if (!function_exists('superAppSsoBase64UrlEncode')) {
    function superAppSsoBase64UrlEncode($bytes) {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}

if (!function_exists('superAppSsoBase64UrlDecode')) {
    function superAppSsoBase64UrlDecode($str) {
        $str = strtr((string) $str, '-_', '+/');
        $resto = strlen($str) % 4;
        if ($resto > 0) {
            $str .= str_repeat('=', 4 - $resto);
        }
        return base64_decode($str, true);
    }
}

if (!function_exists('superAppSsoGerarToken')) {
    /**
     * Gera token assinado (usado principalmente para testes/geração local).
     *
     * @param array    $payload      Dados a embarcar (mesclado com iat/exp/nonce)
     * @param int|null $ttlSegundos  Tempo de vida do token em segundos
     * @return string                Token base64url(payload).base64url(sig)
     */
    function superAppSsoGerarToken(array $payload, $ttlSegundos = null) {
        $ttl = ($ttlSegundos !== null) ? (int) $ttlSegundos : (int) SUPER_APP_SSO_TTL_SEGUNDOS;
        if ($ttl <= 0) {
            $ttl = 60;
        }

        $agora = time();
        $payload['iat']   = $agora;
        $payload['exp']   = $agora + $ttl;
        $payload['nonce'] = bin2hex(random_bytes(8));

        $jsonPayload = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $b64Payload  = superAppSsoBase64UrlEncode($jsonPayload);

        $assinaturaBin = hash_hmac('sha256', $b64Payload, SUPER_APP_SSO_SECRET, true);
        $b64Sig        = superAppSsoBase64UrlEncode($assinaturaBin);

        return $b64Payload . '.' . $b64Sig;
    }
}

if (!function_exists('superAppSsoValidarToken')) {
    /**
     * Valida a assinatura e a expiração de um token SSO.
     *
     * @param string $token
     * @return array  ['ok' => true,  'payload' => [...]]  em caso de sucesso
     *                ['ok' => false, 'reason'  => '...']  em caso de falha
     *                (reasons: config, formato, assinatura, payload, expirado, futuro, sem_email)
     */
    function superAppSsoValidarToken($token) {
        if (!is_string($token) || $token === '') {
            return ['ok' => false, 'reason' => 'formato'];
        }
        if (SUPER_APP_SSO_SECRET === '') {
            return ['ok' => false, 'reason' => 'config'];
        }

        $partes = explode('.', $token);
        if (count($partes) !== 2) {
            return ['ok' => false, 'reason' => 'formato'];
        }
        list($b64Payload, $b64Sig) = $partes;

        // 1) Confere a assinatura (comparação em tempo constante)
        $hmacEsperadoBin = hash_hmac('sha256', $b64Payload, SUPER_APP_SSO_SECRET, true);
        $sigRecebidaBin  = superAppSsoBase64UrlDecode($b64Sig);
        if ($sigRecebidaBin === false || !hash_equals($hmacEsperadoBin, $sigRecebidaBin)) {
            return ['ok' => false, 'reason' => 'assinatura'];
        }

        // 2) Decodifica o payload
        $jsonPayload = superAppSsoBase64UrlDecode($b64Payload);
        if ($jsonPayload === false) {
            return ['ok' => false, 'reason' => 'payload'];
        }
        $payload = json_decode($jsonPayload, true);
        if (!is_array($payload)) {
            return ['ok' => false, 'reason' => 'payload'];
        }

        // 3) Valida expiração (com pequena tolerância de relógio)
        $agora = time();
        if (isset($payload['exp']) && $agora > ((int) $payload['exp'] + 5)) {
            return ['ok' => false, 'reason' => 'expirado'];
        }
        if (isset($payload['iat']) && ((int) $payload['iat']) > ($agora + 30)) {
            return ['ok' => false, 'reason' => 'futuro'];
        }

        // 4) Precisa ter email
        if (empty($payload['email'])) {
            return ['ok' => false, 'reason' => 'sem_email'];
        }

        return ['ok' => true, 'payload' => $payload];
    }
}

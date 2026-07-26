<?php
/**
 * Plugin Name: Tapuziel Pixel
 * Description: First-party Tapuziel CRM pixel for any WordPress site. Injects the universal tz-pixel.js loader — nothing else (see Tapuziel docs/PIXEL-EMBED-INTEGRATION.md).
 * Version: 1.0.0
 * Author: Shaltiel Industries / WhiteNo1se
 * Author URI: https://github.com/WhiteNo1s3
 * License: MIT
 * Text Domain: tapuziel-pixel
 *
 * THE ONE RULE: this plugin is a WRAPPER. It only knows where WordPress puts
 * scripts and which settings to pass as data-* attributes. It performs NO
 * HTTP requests, handles NO events, and touches NO identity — all of that
 * lives in tz-pixel.js and the Tapuziel collector. Tapuziel's smoke-wrappers
 * test greps this file to keep it that way.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('TAPUZIEL_PIXEL_VERSION', '1.0.0');

/**
 * Settings: base URL of the Tapuziel install + registered site id.
 */
function tapuziel_pixel_options()
{
    $defaults = array(
        'base_url' => '',
        'site_id'  => '',
        'spa'      => 0,
        'enabled'  => 1,
    );
    $opts = get_option('tapuziel_pixel', array());
    if (!is_array($opts)) {
        $opts = array();
    }
    return array_merge($defaults, $opts);
}

/** Same normalization as the Tapuziel site registry (crm/sites). */
function tapuziel_pixel_sanitize_site_id($id)
{
    $id = strtolower(trim((string) $id));
    $id = preg_replace('/[^a-z0-9._-]+/', '-', $id);
    $id = trim($id, '-');
    return substr($id, 0, 80);
}

/**
 * HTTPS is a precondition, not a suggestion (docs/CRM-PORTABILITY.md):
 * a plain-http base is accepted ONLY for loopback development targets.
 */
function tapuziel_pixel_sanitize_base($url)
{
    $url = esc_url_raw(trim((string) $url));
    $url = untrailingslashit($url);
    if ($url === '') {
        return '';
    }
    if (preg_match('#^https://#i', $url)) {
        return substr($url, 0, 200);
    }
    if (preg_match('#^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$#i', $url)) {
        return substr($url, 0, 200);
    }
    return '';
}

add_action('admin_menu', function () {
    add_options_page(
        'Tapuziel Pixel',
        'Tapuziel Pixel',
        'manage_options',
        'tapuziel-pixel',
        'tapuziel_pixel_render_settings'
    );
});

add_action('admin_init', function () {
    register_setting('tapuziel_pixel_group', 'tapuziel_pixel', function ($input) {
        $out = tapuziel_pixel_options();
        if (!is_array($input)) {
            return $out;
        }
        $out['base_url'] = tapuziel_pixel_sanitize_base(isset($input['base_url']) ? $input['base_url'] : '');
        $out['site_id']  = tapuziel_pixel_sanitize_site_id(isset($input['site_id']) ? $input['site_id'] : '');
        $out['spa']      = !empty($input['spa']) ? 1 : 0;
        $out['enabled']  = !empty($input['enabled']) ? 1 : 0;
        return $out;
    });
});

function tapuziel_pixel_render_settings()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $o = tapuziel_pixel_options();
    ?>
    <div class="wrap">
      <h1>Tapuziel Pixel</h1>
      <p>Universal first-party CRM pixel — the same <code>tz-pixel.js</code> loader every CMS uses.</p>
      <form method="post" action="options.php">
        <?php settings_fields('tapuziel_pixel_group'); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th scope="row"><label for="tz_enabled">Enabled</label></th>
            <td><label><input type="checkbox" id="tz_enabled" name="tapuziel_pixel[enabled]" value="1" <?php checked($o['enabled'], 1); ?> /> Inject on public pages</label></td>
          </tr>
          <tr>
            <th scope="row"><label for="tz_base">Tapuziel base URL</label></th>
            <td>
              <input type="url" class="regular-text ltr" dir="ltr" id="tz_base" name="tapuziel_pixel[base_url]"
                     value="<?php echo esc_attr($o['base_url']); ?>"
                     placeholder="https://crm.example.com" required />
              <p class="description">Origin only, <strong>HTTPS</strong> (plain http is accepted for localhost only).
                 The host that serves <code>/tz-pixel.js</code> and <code>/_tapuz/collect</code>.</p>
            </td>
          </tr>
          <tr>
            <th scope="row"><label for="tz_site">Site ID</label></th>
            <td>
              <input type="text" class="regular-text ltr" dir="ltr" id="tz_site" name="tapuziel_pixel[site_id]"
                     value="<?php echo esc_attr($o['site_id']); ?>" placeholder="wp-acme" />
              <p class="description">Must be <strong>registered</strong> in Tapuziel (לקוחות → אתרים) —
                 the collector silently drops unregistered ids, by design.</p>
            </td>
          </tr>
          <tr>
            <th scope="row">SPA routes</th>
            <td><label><input type="checkbox" name="tapuziel_pixel[spa]" value="1" <?php checked($o['spa'], 1); ?> /> Track pushState / popstate (headless themes)</label></td>
          </tr>
        </table>
        <?php submit_button('Save'); ?>
      </form>
      <hr />
      <p><strong>Shaltiel Industries</strong> · made by WhiteNo1se · <a href="https://github.com/WhiteNo1s3" target="_blank" rel="noopener">GitHub</a></p>
    </div>
    <?php
}

/**
 * Public inject — the wrapper's ENTIRE job. Nothing is injected until both a
 * valid (HTTPS or loopback) base and a site id exist.
 */
add_action('wp_enqueue_scripts', function () {
    if (is_admin()) {
        return;
    }
    $o = tapuziel_pixel_options();
    $base = tapuziel_pixel_sanitize_base($o['base_url']);
    $site = tapuziel_pixel_sanitize_site_id($o['site_id']);
    if (empty($o['enabled']) || $base === '' || $site === '') {
        return;
    }
    wp_enqueue_script(
        'tapuziel-pixel',
        $base . '/tz-pixel.js',
        array(),
        TAPUZIEL_PIXEL_VERSION,
        array('strategy' => 'defer', 'in_footer' => false)
    );
});

/** Rebuild a clean tag so we control the data-* attributes exactly. */
add_filter('script_loader_tag', function ($tag, $handle, $src) {
    if ($handle !== 'tapuziel-pixel') {
        return $tag;
    }
    $o = tapuziel_pixel_options();
    $base = tapuziel_pixel_sanitize_base($o['base_url']);
    $site = tapuziel_pixel_sanitize_site_id($o['site_id']);
    if ($base === '' || $site === '') {
        return '';
    }
    $spa = !empty($o['spa']) ? ' data-tz-pixel-spa="1"' : '';
    return sprintf(
        '<script src="%s" data-tz-pixel-base="%s" data-tz-pixel-site="%s"%s defer></script>' . "\n",
        esc_url($src),
        esc_url($base),
        esc_attr($site),
        $spa
    );
}, 10, 3);

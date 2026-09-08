<?php

declare(strict_types=1);

/**
 * Optional maintainer check; never invoked by npm, Core CI, or consumers.
 *
 * Usage: php check-twig-php-parity.php TOOLS_CHECKOUT [AUTOLOAD] [--write]
 * See docs/twig-php-parity.md for the pinned, isolated setup.
 */

use Composer\InstalledVersions;
use Drupal\Core\Template\Attribute;
use Drupal\emulsify_tools\AddAttributesTwigExtension;
use Drupal\emulsify_tools\BemTwigExtension;
use Drupal\emulsify_tools\TwigAttributeManager;
use Twig\Environment;
use Twig\Loader\ArrayLoader;

try {
  $arguments = array_slice($argv, 1);
  $write = in_array('--write', $arguments, TRUE);
  $arguments = array_values(array_filter($arguments, static fn (string $value): bool => $value !== '--write'));
  if (count($arguments) < 1 || count($arguments) > 2) {
    throw new RuntimeException('Usage: php check-twig-php-parity.php TOOLS_CHECKOUT [AUTOLOAD] [--write]');
  }

  $checkout = realpath($arguments[0]);
  if ($checkout === FALSE) {
    throw new RuntimeException('Tools checkout does not exist.');
  }
  $corpusPath = __DIR__ . '/../../src/extensions/twig/__fixtures__/parity-v1.json';
  $corpus = json_decode(file_get_contents($corpusPath), TRUE, flags: JSON_THROW_ON_ERROR);
  $revision = $corpus['php']['revision'];

  // Read exact committed bytes so a dirty checkout cannot silently redefine the pin.
  foreach (['TwigAttributeManager', 'BemTwigExtension', 'AddAttributesTwigExtension'] as $class) {
    $relativePath = 'src/' . $class . '.php';
    $process = proc_open(
      ['git', '-C', $checkout, 'show', $revision . ':' . $relativePath],
      [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
      $pipes,
    );
    if (!is_resource($process)) {
      throw new RuntimeException('Cannot read the pinned Tools revision with git.');
    }
    $committed = stream_get_contents($pipes[1]);
    $error = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    if (proc_close($process) !== 0 || $committed !== file_get_contents($checkout . '/' . $relativePath)) {
      throw new RuntimeException('Tools source differs from pinned revision: ' . $relativePath . '. ' . $error);
    }
  }

  $autoload = $arguments[1] ?? $checkout . '/vendor/autoload.php';
  if (!is_file($autoload)) {
    throw new RuntimeException('Composer autoload file not found; follow docs/twig-php-parity.md.');
  }
  require $autoload;
  foreach ($corpus['php']['dependencies'] as $package => $expected) {
    if (!InstalledVersions::isInstalled($package)
      || InstalledVersions::getPrettyVersion($package) !== $expected['version']
      || InstalledVersions::getReference($package) !== $expected['reference']) {
      throw new RuntimeException('Dependency differs from corpus pin: ' . $package);
    }
  }
  // Explicit loading also supports a separate Composer runtime without Tools autoloading.
  require_once $checkout . '/src/TwigAttributeManager.php';
  require_once $checkout . '/src/BemTwigExtension.php';
  require_once $checkout . '/src/AddAttributesTwigExtension.php';

  $manager = new TwigAttributeManager();
  $twig = new Environment(new ArrayLoader(), ['autoescape' => FALSE]);
  $twig->addExtension(new BemTwigExtension($manager));
  $twig->addExtension(new AddAttributesTwigExtension($manager));
  $failures = [];

  foreach ($corpus['cases'] as &$case) {
    $context = $case['context'];
    $context['attributes'] ??= [];
    if ($case['phpContext'] === 'attribute') {
      $context['attributes'] = new Attribute($context['attributes']);
    }
    $rendered = $twig->createTemplate($case['template'])->render($context);
    $remaining = $context['attributes'] instanceof Attribute
      ? $context['attributes']->toArray()
      : $context['attributes'];
    $actual = ['rendered' => $rendered, 'remainingContextAttributes' => (object) $remaining];

    if ($write) {
      $case['expected']['php'] = $actual;
    }
    // Decode the observed empty attribute map consistently with the corpus JSON.
    elseif (json_decode(json_encode($actual, JSON_THROW_ON_ERROR), TRUE) !== $case['expected']['php']) {
      $failures[] = $case['id'];
      fwrite(STDERR, $case['id'] . ': ' . json_encode($actual, JSON_THROW_ON_ERROR) . PHP_EOL);
    }
  }
  unset($case);

  if ($failures !== []) {
    throw new RuntimeException('PHP parity mismatch: ' . implode(', ', $failures));
  }
  if ($write) {
    // Preserve JSON objects in the shared corpus, including empty Core expectations.
    $original = json_decode(file_get_contents($corpusPath), flags: JSON_THROW_ON_ERROR);
    foreach ($corpus['cases'] as $index => $case) {
      $original->cases[$index]->expected->php = $case['expected']['php'];
    }
    $original->php->generatedWithPhp = PHP_VERSION;
    file_put_contents($corpusPath, json_encode($original, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . PHP_EOL);
  }
  fwrite(STDOUT, ($write ? 'Generated ' : 'Verified ') . count($corpus['cases']) . ' PHP cases at Tools ' . $revision . PHP_EOL);
}
catch (Throwable $error) {
  fwrite(STDERR, $error->getMessage() . PHP_EOL);
  exit(1);
}

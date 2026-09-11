<?php

declare(strict_types=1);

/**
 * Optional maintainer check; never required by npm, Core CI, or consumers.
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

$failureKind = 'environment';
$caseId = NULL;

try {
  $arguments = array_slice($argv, 1);
  $write = in_array('--write', $arguments, TRUE);
  $arguments = array_values(array_filter($arguments, static fn (string $value): bool => $value !== '--write'));
  if (count($arguments) < 1 || count($arguments) > 2) {
    throw new RuntimeException('Usage: php check-twig-php-parity.php TOOLS_CHECKOUT [AUTOLOAD] [--write]');
  }

  $checkout = realpath($arguments[0]);
  if ($checkout === FALSE) {
    throw new RuntimeException('Tools checkout does not exist: ' . $arguments[0]);
  }
  $corpusPath = __DIR__ . '/../../src/extensions/twig/__fixtures__/parity-v1.json';
  $corpusJson = file_get_contents($corpusPath);
  $corpus = json_decode($corpusJson, TRUE, flags: JSON_THROW_ON_ERROR);
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
    if (proc_close($process) !== 0) {
      $failureKind = 'provenance';
      throw new RuntimeException('Cannot read Tools pin ' . $revision . ':' . $relativePath . ' in ' . $checkout . ': ' . trim($error));
    }
    $sourcePath = $checkout . '/' . $relativePath;
    $observed = is_file($sourcePath) ? file_get_contents($sourcePath) : FALSE;
    if ($committed !== $observed) {
      $failureKind = 'provenance';
      throw new RuntimeException('Tools source differs from pinned revision: ' . json_encode([
        'path' => $sourcePath,
        'revision' => $revision,
        'expectedSha256' => hash('sha256', $committed),
        'observedSha256' => $observed === FALSE ? NULL : hash('sha256', $observed),
      ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }
  }

  $autoload = $arguments[1] ?? $checkout . '/vendor/autoload.php';
  if (!is_file($autoload)) {
    throw new RuntimeException('Composer autoload file not found: ' . $autoload . '; follow docs/twig-php-parity.md.');
  }
  require $autoload;
  foreach ($corpus['php']['dependencies'] as $package => $expected) {
    $installed = InstalledVersions::isInstalled($package);
    $observed = [
      'version' => $installed ? InstalledVersions::getPrettyVersion($package) : NULL,
      'reference' => $installed ? InstalledVersions::getReference($package) : NULL,
    ];
    if (!$installed || $observed['version'] !== $expected['version'] || $observed['reference'] !== $expected['reference']) {
      $failureKind = 'provenance';
      throw new RuntimeException('Dependency differs from corpus pin: ' . json_encode([
        'package' => $package,
        'expected' => $expected,
        'observed' => $observed,
      ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
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

  $failureKind = 'execution';
  foreach ($corpus['cases'] as $caseIndex => &$case) {
    $caseId = $case['id'];
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
      // Preserve JSON object/map shapes and every serialized character in diagnostics.
      $expected = json_decode($corpusJson, flags: JSON_THROW_ON_ERROR)->cases[$caseIndex]->expected->php;
      fwrite(STDERR, json_encode([
        'kind' => 'output-mismatch',
        'runtime' => ['name' => 'PHP', 'version' => PHP_VERSION],
        'caseId' => $caseId,
        'expected' => $expected,
        'observed' => $actual,
      ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    }
  }
  unset($case);
  $caseId = NULL;

  if ($failures !== []) {
    $failureKind = 'output-mismatch';
    throw new RuntimeException('PHP parity mismatch: ' . implode(', ', $failures));
  }
  if ($write) {
    $failureKind = 'environment';
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
  fwrite(STDERR, '[' . $failureKind . '] PHP ' . PHP_VERSION . ($caseId === NULL ? '' : ' case ' . $caseId) . ': ' . $error->getMessage() . PHP_EOL);
  exit(1);
}

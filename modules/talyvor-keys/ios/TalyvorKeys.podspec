Pod::Spec.new do |s|
  s.name           = 'TalyvorKeys'
  s.version        = '1.0.0'
  s.summary        = 'The approval key in the Secure Enclave, usable only after Face ID or Touch ID'
  s.license        = 'BUSL-1.1'
  s.author         = 'Talyvor'
  s.homepage       = 'https://github.com/Talyvor/talyvor-mobile'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Talyvor/talyvor-mobile.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end

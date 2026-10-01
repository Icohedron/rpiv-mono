{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:

{
  devcontainer.enable = true;
  packages = [ pkgs.nodejs_24 ];
}

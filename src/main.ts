import defaultYaml from '../config/default.yaml?raw';
import { parseConfig } from './config/load';

const config = parseConfig(defaultYaml);
console.info('parallax-demo config', config);

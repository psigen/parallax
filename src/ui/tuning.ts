import GUI from 'lil-gui';
import type { LightingConfig, TrackingConfig } from '../config/schema';
import type { Placement } from '../scenes/manifest';

/** Live tuning of filter and prediction parameters (key `g`). Changes are not persisted. */
export class TuningPanel {
  private readonly gui: GUI;

  constructor(
    tracking: TrackingConfig,
    lighting: LightingConfig,
    placement: Placement,
    onPlacementChange: () => void,
    onChange: (t: TrackingConfig) => void,
  ) {
    this.gui = new GUI({ title: 'tracking', width: 260 });
    const f = this.gui.addFolder('One Euro filter');
    f.add(tracking.filter, 'min_cutoff_hz', 0.1, 10, 0.1).name('min cutoff Hz');
    f.add(tracking.filter, 'beta', 0, 1, 0.005).name('beta');
    f.add(tracking.filter, 'd_cutoff_hz', 0.1, 10, 0.1).name('deriv cutoff Hz');
    const p = this.gui.addFolder('prediction');
    p.add(tracking.prediction, 'enabled');
    p.add(tracking.prediction, 'extra_lead_ms', -50, 150, 1).name('extra lead ms');
    p.add(tracking.prediction, 'max_lead_ms', 0, 200, 1).name('max lead ms');
    this.gui.add(tracking, 'loss_timeout_ms', 100, 3000, 50).name('loss timeout ms');
    const e = this.gui.addFolder('eye model');
    e.add(tracking, 'eye', ['cyclopean', 'left', 'right']).name('render for');
    e.add(tracking, 'yaw_correction').name('yaw correction');
    e.add(tracking, 'parallax_gain', 0.25, 2, 0.05).name('parallax gain');
    const l = this.gui.addFolder('camera lighting (live)');
    l.add(lighting.environment, 'intensity', 0, 3, 0.05).name('environment');
    l.add(lighting.environment, 'update_hz', 1, 30, 1).name('update Hz');
    l.add(lighting.key_lights, 'threshold', 0.3, 1, 0.01).name('peak threshold');
    l.add(lighting.key_lights, 'min_area_px', 1, 40, 1).name('min area px');
    l.add(lighting.key_lights.brightness, 'gain', 0, 1000, 5).name('key gain');
    l.add(lighting.key_lights.brightness, 'saturation_boost', 1, 6, 0.1).name('saturation boost');
    l.add(lighting.key_lights, 'smoothing_hz', 0.5, 10, 0.5).name('smoothing Hz');
    const s = this.gui.addFolder('scene placement');
    s.add(placement, 'scale', 0.02, 2, 0.005).name('scale').onChange(onPlacementChange);
    s.add(placement.position_mm, '0', -1000, 1000, 1).name('x mm').onChange(onPlacementChange);
    s.add(placement.position_mm, '1', -1000, 1000, 1).name('y mm').onChange(onPlacementChange);
    s.add(placement.position_mm, '2', -3000, 500, 1).name('z mm').onChange(onPlacementChange);
    s.add(placement.rotation_deg, '0', -180, 180, 0.5).name('pitch °').onChange(onPlacementChange);
    s.add(placement.rotation_deg, '1', -180, 180, 0.5).name('yaw °').onChange(onPlacementChange);
    s.add(placement.rotation_deg, '2', -180, 180, 0.5).name('roll °').onChange(onPlacementChange);
    this.gui.onChange(() => onChange(tracking));
    this.gui.hide();
  }

  toggle(): void {
    this.gui.show(this.gui._hidden);
  }
}

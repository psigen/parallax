import GUI from 'lil-gui';
import type { TrackingConfig } from '../config/schema';

/** Live tuning of filter and prediction parameters (key `g`). Changes are not persisted. */
export class TuningPanel {
  private readonly gui: GUI;

  constructor(tracking: TrackingConfig, onChange: (t: TrackingConfig) => void) {
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
    this.gui.onChange(() => onChange(tracking));
    this.gui.hide();
  }

  toggle(): void {
    this.gui.show(this.gui._hidden);
  }
}

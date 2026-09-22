import Link from "next/link";
import styles from "./onboarding.module.css";

export default function OnboardingPage() {
  return <main className={styles.page}><section className={styles.shell}><div className={styles.aside}><div className={styles.logo}>W</div><p>WEBOPS AI</p><h1>Build your command center.</h1><span>Secure tenant setup, project governance, and evidence-first audits in one guided flow.</span><div className={styles.steps}><b className={styles.active}>01 Identity secured</b><b>02 Workspace provisioning</b><b>03 Baseline audit</b></div></div><div className={styles.card}><div className={styles.kicker}>FOUNDATION SETUP</div><h2>Your secure workspace is active</h2><p>Authentication and the premium application shell are ready. Organization and project provisioning is the next production increment.</p><Link href="/workspace">Continue to Command Center</Link><small>Your existing audit engine remains available while the tenant layer is connected.</small></div></section></main>;
}

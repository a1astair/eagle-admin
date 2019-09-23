import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.util.regex.Pattern

@NonCPS
String getUrlForRoute(String routeName, String projectNameSpace = '') {

  def nameSpaceFlag = ''
  if(projectNameSpace?.trim()) {
    nameSpaceFlag = "-n ${projectNameSpace}"
  }

  def url = sh (
    script: "oc get routes ${nameSpaceFlag} -o wide --no-headers | awk \'/${routeName}/{ print match(\$0,/edge/) ?  \"https://\"\$2 : \"http://\"\$2 }\'",
    returnStdout: true
  ).trim()

  return url
}

/*
 * Sends a rocket chat notification
 */
def notifyRocketChat(text, url) {
    // def rocketChatURL = url
    // def message = text.replaceAll(~/\'/, "")
    // def payload = JsonOutput.toJson([
    //   "username":"Jenkins",
    //   "icon_url":"https://wiki.jenkins.io/download/attachments/2916393/headshot.png",
    //   "text": message
    // ])

    // sh("curl -X POST -H 'Content-Type: application/json' --data \'${payload}\' ${rocketChatURL}")
}


/*
 * takes in a sonarqube status json payload
 * and returns the status string
 */
def sonarGetStatus (jsonPayload) {
  def jsonSlurper = new JsonSlurper()
  return jsonSlurper.parseText(jsonPayload).projectStatus.status
}

/*
 * Updates the global pastBuilds array: it will iterate recursively
 * and add all the builds prior to the current one that had a result
 * different than 'SUCCESS'.
 */
def buildsSinceLastSuccess(previousBuild, build) {
  if ((build != null) && (build.result != 'SUCCESS')) {
    pastBuilds.add(build)
    buildsSinceLastSuccess(pastBuilds, build.getPreviousBuild())
  }
}

/*
 * Generates a string containing all the commit messages from
 * the builds in pastBuilds.
 */
@NonCPS
def getChangeLog(pastBuilds) {
  def log = ""
  for (int x = 0; x < pastBuilds.size(); x++) {
    for (int i = 0; i < pastBuilds[x].changeSets.size(); i++) {
      def entries = pastBuilds[x].changeSets[i].items
      for (int j = 0; j < entries.length; j++) {
        def entry = entries[j]
        log += "* ${entry.msg} by ${entry.author} \n"
      }
    }
  }
  return log;
}

def nodejsTester () {
  openshift.withCluster() {
    openshift.withProject() {
      podTemplate(label: 'node-tester', name: 'node-tester', serviceAccount: 'jenkins', cloud: 'openshift', containers: [
        containerTemplate(
          name: 'jnlp',
          image: 'registry.access.redhat.com/openshift3/jenkins-agent-nodejs-8-rhel7',
          resourceRequestCpu: '500m',
          resourceLimitCpu: '800m',
          resourceRequestMemory: '2Gi',
          resourceLimitMemory: '4Gi',
          workingDir: '/tmp',
          command: '',
        )
      ]) {
        node("node-tester") {
          checkout scm
          try {
            sh 'npm run tests'
          } finally {
            echo "Unit Tests Passed"
          }
        }
      }
      return true
    }
  }
}

def nodejsLinter () {
  openshift.withCluster() {
    openshift.withProject() {
      podTemplate(label: 'node-linter', name: 'node-linter', serviceAccount: 'jenkins', cloud: 'openshift', containers: [
        containerTemplate(
          name: 'jnlp',
          image: 'registry.access.redhat.com/openshift3/jenkins-agent-nodejs-8-rhel7',
          resourceRequestCpu: '500m',
          resourceLimitCpu: '800m',
          resourceRequestMemory: '2Gi',
          resourceLimitMemory: '4Gi',
          activeDeadlineSeconds: '1200',
          workingDir: '/tmp',
          command: '',
          args: '${computer.jnlpmac} ${computer.name}',
        )
      ]) {
        node("node-linter") {
          checkout scm
          try {
            // install deps to get angular-cli
            sh '''
              npm install @angular/compiler @angular/core @angular/cli @angular-devkit/build-angular codelyzer rxjs tslint
              npm run lint
            '''
          } finally {
            echo "Linting Done"
          }
        }
      }
      return true
    }
  }
}

// todo templates can be pulled from a repository, instead of declared here
def nodejsSonarqube () {
  openshift.withCluster() {
    openshift.withProject() {
      podTemplate(label: 'node-sonarqube', name: 'node-sonarqube', serviceAccount: 'jenkins', cloud: 'openshift', containers: [
        containerTemplate(
          name: 'jnlp',
          image: 'registry.access.redhat.com/openshift3/jenkins-agent-nodejs-8-rhel7',
          resourceRequestCpu: '500m',
          resourceLimitCpu: '1000m',
          resourceRequestMemory: '2Gi',
          resourceLimitMemory: '4Gi',
          workingDir: '/tmp',
          command: '',
          args: '${computer.jnlpmac} ${computer.name}',
        )
      ]) {
        node("node-sonarqube") {
          checkout scm
          dir('sonar-runner') {
            try {
              // run scan
              sh("oc extract secret/sonarqube-secrets --to=${env.WORKSPACE}/sonar-runner --confirm")
              SONARQUBE_URL = sh(returnStdout: true, script: 'cat sonarqube-route-url')

              sh "npm install typescript"
              sh returnStdout: true, script: "./gradlew sonarqube -Dsonar.host.url=${SONARQUBE_URL} -Dsonar. -Dsonar.verbose=true --stacktrace --info"

              // wiat for scan status to update
              sleep(30)

              // check if sonarqube passed
              sh("oc extract secret/sonarqube-status-urls --to=${env.WORKSPACE}/sonar-runner --confirm")
              SONARQUBE_STATUS_URL = sh(returnStdout: true, script: 'cat sonarqube-status-admin')

              SONARQUBE_STATUS_JSON = sh(returnStdout: true, script: "curl -w '%{http_code}' '${SONARQUBE_STATUS_URL}'")
              SONARQUBE_STATUS = sonarGetStatus (SONARQUBE_STATUS_JSON)

              if ( "${SONARQUBE_STATUS}" == "ERROR") {
                echo "Scan Failed"

                notifyRocketChat(
                  "@all The latest build, ${env.BUILD_DISPLAY_NAME} of eagle-admin seems to be broken. \n ${env.BUILD_URL}\n Error: \n Sonarqube scan failed",
                  ROCKET_DEPLOY_WEBHOOK
                )

                currentBuild.result = 'FAILURE'
                exit 1
              } else {
                echo "Scan Passed"
              }

            } catch (error) {
              notifyRocketChat(
                "@all The latest build of eagle-admin seems to be broken. \n ${env.BUILD_URL}\n Error: \n ${error.message}",
                ROCKET_DEPLOY_WEBHOOK
              )
              throw error
            } finally {
              echo "Scan Complete"
            }
          }
        }
      }
      return true
    }
  }
}

def zapScanner () {
  openshift.withCluster() {
    openshift.withProject() {
      // The jenkins-slave-zap image has been purpose built for supporting ZAP scanning.
      podTemplate(
        label: 'owasp-zap',
        name: 'owasp-zap',
        serviceAccount: 'jenkins',
        cloud: 'openshift',
        containers: [
          containerTemplate(
            name: 'jnlp',
            image: '172.50.0.2:5000/openshift/jenkins-slave-zap',
            resourceRequestCpu: '500m',
            resourceLimitCpu: '1000m',
            resourceRequestMemory: '3Gi',
            resourceLimitMemory: '4Gi',
            workingDir: '/home/jenkins',
            command: '',
            args: '${computer.jnlpmac} ${computer.name}'
          )
        ]
      ){
        node('owasp-zap') {
          stage('ZAP Security Scan') {

            // The name  of the ZAP report
            def ZAP_REPORT_NAME = "zap-report.xml"

            // The location of the ZAP reports
            def ZAP_REPORT_PATH = "/zap/wrk/${ZAP_REPORT_NAME}"

            // The name of the "stash" containing the ZAP report
            def ZAP_REPORT_STASH = "zap-report"

            // Dynamicaly determine the target URL for the ZAP scan ...
            def TARGET_URL = getUrlForRoute('eagle-public', 'mem-mmti-prod').trim()
            def API_TARGET_URL="${TARGET_URL}/api/"

            echo "Target URL: ${TARGET_URL}"
            echo "API Target URL: ${API_TARGET_URL}"

            dir('zap') {

              // The ZAP scripts are installed on the root of the jenkins-slave-zap image.
              // When running ZAP from there the reports will be created in /zap/wrk/ by default.
              // ZAP has problems with creating the reports directly in the Jenkins
              // working directory, so they have to be copied over after the fact.
              def retVal = sh (
                returnStatus: true,
                script: "/zap/zap-baseline.py -x ${ZAP_REPORT_NAME} -t ${TARGET_URL}"
                // Other scanner options ...
                // zap-api-scan errors out
                // script: "/zap/zap-api-scan.py -x ${ZAP_REPORT_NAME} -t ${API_TARGET_URL} -f ${API_FORMAT}"
                // script: "/zap/zap-full-scan.py -x ${ZAP_REPORT_NAME} -t ${TARGET_URL}"
              )
              echo "Return value is: ${retVal}"

              // Copy the ZAP report into the Jenkins working directory so the Jenkins tools can access it.
              sh (
                returnStdout: true,
                script: "mkdir -p ./wrk/ && cp /zap/wrk/${ZAP_REPORT_NAME} ./wrk/"
              )
            }

            // Stash the ZAP report for publishing in a different stage (which will run on a different pod).
            echo "Stash the report for the publishing stage ..."
            stash name: "${ZAP_REPORT_STASH}", includes: "zap/wrk/*.xml"
          }
        }
      }
    }
  }
}

def postZapToSonar () {
  openshift.withCluster() {
    openshift.withProject() {
      // The jenkins-python3nodejs template has been purpose built for supporting SonarQube scanning.
      podTemplate(
        label: 'jenkins-python3nodejs',
        name: 'jenkins-python3nodejs',
        serviceAccount: 'jenkins',
        cloud: 'openshift',
        containers: [
          containerTemplate(
            name: 'jnlp',
            image: '172.50.0.2:5000/openshift/jenkins-slave-python3nodejs',
            resourceRequestCpu: '1000m',
            resourceLimitCpu: '2000m',
            resourceRequestMemory: '2Gi',
            resourceLimitMemory: '4Gi',
            workingDir: '/tmp',
            command: '',
            args: '${computer.jnlpmac} ${computer.name}'
          )
        ]
      ){
        node('jenkins-python3nodejs') {

          stage('Publish ZAP Report to SonarQube') {

             // The name  of the ZAP report
            def ZAP_REPORT_NAME = "zap-report.xml"

            // The location of the ZAP reports
            def ZAP_REPORT_PATH = "/zap/wrk/${ZAP_REPORT_NAME}"

            // The name of the "stash" containing the ZAP report
            def ZAP_REPORT_STASH = "zap-report"

            // Do a sparse checkout of the sonar-runner folder since it is the only
            // part of the project we need to publish the ZAP report to SonarQube.
            // We're not scanning our source code here ...
            //
            // For this to work the Jenkins Administrator may have to approve the following methods;
            // - method hudson.plugins.git.GitSCM getBranches
            // - method hudson.plugins.git.GitSCM getUserRemoteConfigs
            // - method hudson.plugins.git.GitSCMBackwardCompatibility getExtensions
            // - staticMethod org.codehaus.groovy.runtime.DefaultGroovyMethods plus java.util.Collection java.lang.Object
            echo "Checking out the sonar-runner folder ..."
            checkout scm

            echo "Preparing the report for the publishing ..."
            unstash name: "${ZAP_REPORT_STASH}"

            sh("oc extract secret/sonarqube-secrets --to=${env.WORKSPACE}/sonar-runner --confirm")
            SONARQUBE_URL = sh(returnStdout: true, script: 'cat sonarqube-route-url')

            echo "Publishing the report ..."
            // The `sonar-runner` MUST exist in your project and contain a Gradle environment consisting of:
            // - Gradle wrapper script(s)
            // - A simple `build.gradle` file that includes the SonarQube plug-in.
            //
            // An example can be found here:
            // - https://github.com/BCDevOps/sonarqube
            dir('sonar-runner') {
              // ======================================================================================================
              // Set your SonarQube scanner properties at this level, not at the Gradle Build level.
              // The only thing that should be defined at the Gradle Build level is a minimal set of generic defaults.
              //
              // For more information on available properties visit:
              // - https://docs.sonarqube.org/display/SCAN/Analyzing+with+SonarQube+Scanner+for+Gradle
              // ======================================================================================================
              sh (
                // 'sonar.zaproxy.reportPath' must be set to the absolute path of the xml formatted ZAP report.
                // Exclude the report from being scanned as an xml file.  We only care about the results of the ZAP scan.
                returnStdout: true,
                script: "./gradlew sonarqube --stacktrace --info \
                  -Dsonar.verbose=true \
                  -Dsonar.host.url=${SONARQUBE_URL} \
                  -Dsonar.projectName='eagle-admin'\
                  -Dsonar.projectKey='org.sonarqube:eagle-admin' \
                  -Dsonar.projectBaseDir='../' \
                  -Dsonar.sources='./src/app' \
                  -Dsonar.zaproxy.reportPath=${WORKSPACE}${ZAP_REPORT_PATH} \
                  -Dsonar.exclusions=**/*.xml"
              )
            }
          }
        }
      }
    }
  }
}

def CHANGELOG = "No new changes"
def IMAGE_HASH = "latest"

pipeline {
  agent any
  options {
    disableResume()
  }
  stages {
    // stage('Parallel Build Steps') {
    //   failFast true
    //   parallel {
        // stage('Build') {
        //   agent any
        //   steps {
        //     script {
        //       pastBuilds = []
        //       buildsSinceLastSuccess(pastBuilds, currentBuild);
        //       CHANGELOG = getChangeLog(pastBuilds);

        //       echo ">>>>>>Changelog: \n ${CHANGELOG}"

        //       try {
        //         sh("oc extract secret/rocket-chat-secrets --to=${env.WORKSPACE} --confirm")
        //         ROCKET_DEPLOY_WEBHOOK = sh(returnStdout: true, script: 'cat rocket-deploy-webhook')
        //         ROCKET_QA_WEBHOOK = sh(returnStdout: true, script: 'cat rocket-qa-webhook')

        //         echo "Building eagle-admin develop branch"
        //         openshiftBuild bldCfg: 'eagle-admin-angular', showBuildLogs: 'true'
        //         openshiftBuild bldCfg: 'eagle-admin-build', showBuildLogs: 'true'
        //         echo "Build done"

        //         echo ">>> Get Image Hash"
        //         // Don't tag with BUILD_ID so the pruner can do it's job; it won't delete tagged images.
        //         // Tag the images for deployment based on the image's hash
        //         IMAGE_HASH = sh (
        //           script: """oc get istag eagle-admin:latest -o template --template=\"{{.image.dockerImageReference}}\"|awk -F \":\" \'{print \$3}\'""",
        //           returnStdout: true).trim()
        //         echo ">> IMAGE_HASH: ${IMAGE_HASH}"
        //       } catch (error) {
        //         notifyRocketChat(
        //           "@all The build ${env.BUILD_DISPLAY_NAME} of eagle-admin, seems to be broken.\n ${env.BUILD_URL}\n Error: \n ${error.message}",
        //           ROCKET_QA_WEBHOOK
        //         )
        //         throw error
        //       }
        //     }
        //   }
        // }

         // stage('Unit Tests') {
        //   steps {
        //     script {
        //       echo "Running unit tests"
        //       def results = nodejsTester()
        //     }
        //   }
        // }

        // stage('Linting') {
        //   steps {
        //     script {
        //       echo "Running linter"
        //       def results = nodejsLinter()
        //     }
        //   }
        // }

        // stage('Sonarqube') {
        //   steps {
        //     script {
        //       echo "Running Sonarqube"
        //       def result = nodejsSonarqube()
        //     }
        //   }
        // }
    //   }
    // }

    // stage('Deploy to dev'){
    //   steps {
    //     script {
    //       try {
    //         echo "Deploying to dev..."
    //         openshiftTag destStream: 'eagle-admin', verbose: 'false', destTag: 'dev', srcStream: 'eagle-admin', srcTag: "${IMAGE_HASH}"
    //         sleep 5

    //         openshiftVerifyDeployment depCfg: 'eagle-admin', namespace: 'esm-dev', replicaCount: 1, verbose: 'false', verifyReplicaCount: 'false', waitTime: 600000
    //         echo ">>>> Deployment Complete"

    //         notifyRocketChat(
    //           "A new version of eagle-admin is now in Dev, build ${env.BUILD_DISPLAY_NAME} \n Changes: \n ${CHANGELOG}",
    //           ROCKET_DEPLOY_WEBHOOK
    //         )

    //         notifyRocketChat(
    //           "@all A new version of eagle-admin is now in Dev and ready for QA. \n Changes to Dev: \n ${CHANGELOG}",
    //           ROCKET_QA_WEBHOOK
    //         )
    //       } catch (error) {
    //         notifyRocketChat(
    //           "@all The build ${env.BUILD_DISPLAY_NAME} of eagle-admin, seems to be broken.\n ${env.BUILD_URL}\n Error: ${error.message}",
    //           ROCKET_DEPLOY_WEBHOOK
    //         )
    //         currentBuild.result = "FAILURE"
    //         throw new Exception("Deploy failed")
    //       }
    //     }
    //   }
    // }

    stage('Zap') {
      steps {
        script {
          echo "Running Zap Scan"
          def result = zapScanner()
        }
      }
    }


    stage('Zap to Sonarqube') {
      steps {
        script {
          echo "Posting Zap Scan to Sonarqube Report"
          def result = postZapToSonar()
        }
      }
    }


    // stage('BDD Tests') {
    //   agent { label: bddPodLabel }
    //   steps{
    //     echo "checking out source"
    //     echo "Build: ${BUILD_ID}"
    //     checkout scm
    //     // todo determine how to call improved BDD Stack
    //   }
    // }
  }
}

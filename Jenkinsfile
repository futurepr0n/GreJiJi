pipeline {
  agent {
    node {
      label 'dev-docker-ssh'
      customWorkspace '/home/jenkins/workspace/grejiji-pipeline'
    }
  }

  options {
    disableConcurrentBuilds()
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    password(
      name: 'AUTH_TOKEN_SECRET',
      defaultValue: '',
      description: 'Runtime auth token secret used by deploy validation gate.'
    )
  }

  environment {
    APP_NAME = 'grejiji-api'
    IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT?.take(7) ?: 'local'}"
    APP_HOST_PORT = "${env.APP_HOST_PORT ?: '3333'}"
    APP_CONTAINER_PORT = "${env.APP_CONTAINER_PORT ?: '3000'}"
    APP_SERVICE_NAME = "${env.APP_SERVICE_NAME ?: 'api'}"
    ALLOW_PORT_FALLBACK = "${env.ALLOW_PORT_FALLBACK ?: '1'}"
    ROLLBACK_SIMULATION_ENABLED = "${env.ROLLBACK_SIMULATION_ENABLED ?: 'true'}"
    AUTH_TOKEN_SECRET = "${params.AUTH_TOKEN_SECRET ?: env.AUTH_TOKEN_SECRET ?: ''}"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Test Gate') {
      steps {
        sh '''
          docker run --rm \
            --user "$(id -u):$(id -g)" \
            -v "$PWD:/workspace" \
            -w /workspace \
            node:20-bookworm-slim \
            sh -lc "npm ci && npm test"
        '''
      }
    }

    stage('Build Docker Image') {
      steps {
        sh 'docker build -t ${APP_NAME}:${IMAGE_TAG} .'
      }
    }

    stage('Deploy Docker') {
      when {
        expression {
          return (env.DEPLOY_ENABLED ?: 'true') == 'true'
        }
      }
      steps {
        sh 'chmod +x ./scripts/jenkins/deploy-docker.sh'
        sh './scripts/jenkins/deploy-docker.sh'
      }
    }

    stage('Rollback Simulation Gate') {
      when {
        expression {
          return (env.DEPLOY_ENABLED ?: 'true') == 'true' &&
            (env.ROLLBACK_SIMULATION_ENABLED ?: 'true') == 'true'
        }
      }
      steps {
        sh '''
          set +e
          HEALTHCHECK_PATH="/__force_rollback_probe__" ./scripts/jenkins/deploy-docker.sh > rollback-simulation.log 2>&1
          status=$?
          set -e

          cat rollback-simulation.log

          if [ "$status" -eq 0 ]; then
            echo "Rollback simulation expected failure, but deploy script succeeded."
            exit 1
          fi

          grep -q "Attempting rollback to previous image" rollback-simulation.log
          grep -q "Rollback succeeded and service is healthy." rollback-simulation.log
        '''
      }
    }
  }

  post {
    always {
      sh 'docker image ls | head -n 20 || true'
    }
    success {
      echo 'Jenkins pipeline completed successfully.'
    }
    failure {
      echo 'Jenkins pipeline failed. Check stage logs and docker runtime output.'
    }
  }
}

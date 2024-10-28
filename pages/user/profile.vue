<template>
  <account-layout
    class="user-profile-wrapper"
    active-route="profile"
    :class="{'email-login': !loggedInWithEmail}"
  >
    <template v-slot:rightArea>

      <div
        class="spinner-wrapper flex"
        v-if="fetchingProfileData"
      >
        <spinner
          :radius="100"
        />
      </div>

      <div v-else class="card">
        <h5 class="ptb-10 plr-20 plr-sm-15 b-b bold flex sided mlr-0">
          {{ $t('accountLayout.myProfile') }}


          <ajax-button
            class="primary-btn plr-30 plr-sm-15"
            type="button"
            :fetching-data="deletingAccount"
            @clicked="deleteAccount"
            :text="$t('date.da')"
          />
        </h5>
        <div
          class="flex wrap sided align-start p-20 pb-0 p-sm-15 pb-sm pb-xs"
        >
          <div>
            <div class="input-wrap">
              <label>
                {{ $t('addressPopup.email') }}
              </label>
              <p>{{ email }}</p>
            </div>

            <div class="input-wrap">
              <label>
                {{ $t('orders.loggedWith') }}
              </label>
              <p>{{ loggedInWith }}</p>
            </div>

            <form
              class="user-form mt-20 mt-sm-15"
              @submit.prevent="updateUserProfile"
            >
              <p class="form-title">
                {{ $t('orders.updateProfile') }}
              </p>

              <div
                class="input-wrap"
                :class="{invalid: !name && hasProfileError}"
              >
                <label>
                  {{ $t('addressPopup.name') }}
                </label>
                <div class="icon-input">
                  <i
                    class="icon user-icon"
                  />
                  <input
                    type="text"
                    v-model="name"
                    :placeholder="$t('addressPopup.name')"
                  >
                </div>
                <span
                  class="error"
                  v-if="!name && hasProfileError"
                >
                    {{ $t('addressPopup.isRequired', { type: $t('addressPopup.name')}) }}
                  </span>
              </div>

              <div class="flex j-end m-0">
                <ajax-button
                  class="primary-btn plr-30 plr-sm-15"
                  :fetching-data="profileSubmitting"
                  :text="$t('orders.updateProfile')"
                />
              </div>
            </form>
          </div>

          <div v-if="loggedInWithEmail">
            <form class="user-form" @submit.prevent="updatePassword">
              <p class="form-title">
                {{ $t('profile.updatePassword') }}
              </p>
              <div
                class="input-wrap"
                :class="{invalid: !currentPassword && hasPasswordError}"
              >
                <label>
                  {{ $t('profile.currentPassword') }}
                </label>
                <password-field
                  :value="currentPassword"
                  @change="currentPassword = $event"
                />
                <span
                  class="error"
                  v-if="!currentPassword && hasPasswordError"
                >
                    {{ $t('addressPopup.isRequired', {type: $t('profile.password') }) }}
                  </span>
              </div>

              <div class="input-wrap" :class="{invalid: !passwordValid && hasPasswordError}">
                <label>
                  {{ $t('profile.password') }}
                </label>

                <password-field
                  :value="newPassword"
                  @change="newPassword = $event"
                />
                <span
                  class="error"
                  v-if="!newPassword && hasPasswordError"
                >
                     {{ $t('addressPopup.isRequired', {type: $t('profile.password') }) }}
                  </span>
                <span
                  class="error"
                  v-else-if="invalidPassword && hasPasswordError"
                >
                    {{ $t('profile.invalidLength') }}
                  </span>
              </div>
              <div
                class="input-wrap"
                :class="{invalid: (!passwordValid || confirmPassword !== newPassword)  && hasPasswordError}"
              >
                <label>
                  {{ $t('profile.confirmPassword') }}
                </label>
                <password-field
                  :value="confirmPassword"
                  @change="confirmPassword = $event"
                />
                <span
                  class="error"
                  v-if="!confirmPassword && hasPasswordError"
                >
                     {{ $t('addressPopup.isRequired', {type: $t('profile.password') }) }}
                  </span>
                <span
                  class="error"
                  v-else-if="confirmPassword !== newPassword && hasPasswordError"
                >
                     {{ $t('profile.noMatch') }}
                  </span>
              </div>
              <div class="flex j-end m-0">
                <ajax-button
                  class="primary-btn plr-30"
                  :fetching-data="passwordSubmitting"
                  :loading-text="$t('profile.updatingPassword')"
                  :text="$t('profile.updatePassword')"
                />
              </div>
            </form>
          </div>
        </div>


      </div>
    </template>
  </account-layout>
</template>

<script>

  import util from '~/mixin/util'
  import validation from '~/mixin/validation'
  import AccountLayout from '~/components/AccountLayout'
  import Spinner from '~/components/Spinner'
  import {mapGetters, mapActions} from 'vuex'
  import AjaxButton from "~/components/AjaxButton";
  import PasswordField from "~/components/PasswordField";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware', 'auth'],
    head() {
      return {
        title: 'Profile',
        meta: []
      }
    },
    data() {
      return {
        name: '',
        email: '',
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        hasProfileError: false,
        deletingAccount: false,
        hasPasswordError: false,
        profileSubmitting: false,
        passwordSubmitting: false,
        fetchingProfileData: false
      }
    },
    components: {
      PasswordField,
      AjaxButton,
      AccountLayout,
      Spinner
    },

    watch: {
      profile(value) {
        if (this.profile) {
          this.email = value?.email
          this.name = value?.name
        }
      },
    },
    mixins: [util, validation, global],
    computed: {
      loggedInWithGoogle() {
        return this.profile && this.profile?.google_id
      },
      loggedInWithFacebook() {
        return this.profile && this.profile?.facebook_id
      },
      loggedInWithEmail() {
        return this.profile && !this.profile?.facebook_id && !this.profile?.google_id
      },
      loggedInWith() {
        if (this.profile) {
          if (this.loggedInWithGoogle) {
            return this.$t('profile.google')
          } else if (this.loggedInWithFacebook) {
            return this.$t('profile.facebook')
          } else {
            return this.$t('addressPopup.email')
          }
        }
      },
      invalidPassword() {
        return !this.isValidLength(this.newPassword)
      },
      passwordValid() {
        return this.newPassword && !this.invalidPassword
      },
      ...mapGetters('user', ['profile'])
    },
    methods: {

      async deleteAccount() {

        if (confirm(this.$t('cartProductTile.deleteAlert'))) {
          this.deletingAccount = true

          const data = await this.deleteRequest({
            api: 'deleteAccount',
            requiredToken: true,
            lang: this.langCode,
          })
          this.deletingAccount = false


          if(data?.status === 200){
            this.setToastMessage(data.message)
            this.$auth.logout()
          }else {
            this.setToastError(data.data.form.join(', '))
          }
          this.deletingAccount = 0
        }

      },

      async updatePassword() {

        if (this.currentPassword && this.newPassword && (this.newPassword === this.confirmPassword)) {
          this.passwordSubmitting = true
          const data = await this.updateUserPassword({
            current_password: this.currentPassword,
            new_password: this.newPassword
          })
          if (data?.status === 201) {
            this.setToastError(data.data.form.join(', '))
          } else if (data?.status === 200) {
            this.loggingOut()
            this.setToastMessage(data.message)
          }
          this.passwordSubmitting = false
        } else {
          this.hasPasswordError = true
        }
      },
      async loggingOut() {
        try {
          this.$auth.logout()
          this.emptyCartProduct()
        } catch (e) {
          return this.$nuxt.error(e)
        }
      },
      async updateUserProfile() {
        if (this.name) {
          this.profileSubmitting = true
          const data = await this.updateProfile({
            name: this.name
          })
          this.profileSubmitting = false
          if (data?.status === 201) {
            this.setToastError(data.data.form.join(', '))

          } else if (data?.status === 200) {
            const updatedUser = {...this.$auth.user}
            updatedUser.name = data.data.name
            this.$auth.setUser(updatedUser)
            this.setToastMessage(data.message)
          } else if (data?.status !== 200) {
            this.hasError(data)
          }
        } else {
          this.hasProfileError = true
        }
      },
      ...mapActions('cart', ['emptyCartProduct']),
      ...mapActions('common', ['setToastMessage', 'setToastError', 'deleteRequest']),
      ...mapActions('user', ['updateProfile', 'updateUserPassword'])
    },
    async mounted() {
      if (this.profile) {
        this.email = this.profile?.email
        this.name = this.profile?.name
      }
    },
  }
</script>

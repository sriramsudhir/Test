<template>
  <form
    class="address-form"
    @submit.prevent="savingAddressData"
  >
    <div
      v-if="countryList"
      class="input-wrap"
    >
      <label>
        {{ $t('addressPopup.country') }}
      </label>
      <dropdown
        :selected-key="addressData.country"
        :options="countryList"
        key-name="name"
        :searching="true"
        @clicked="selectCountry"
      />
    </div>


    <div
      class="input-wrap"
      :class="{invalid: !emailValid && hasAddressErrors}"
    >
      <label>
        {{ $t('addressPopup.email') }}
      </label>
      <div class="icon-input">
        <i
          class="icon email-icon"
        />
        <input
          type="text"
          :placeholder="$t('contact.your', { type: $t('contact.email') })"
          v-model.trim="addressData.email"
        >
      </div>

      <span
        class="error"
        v-if="!addressData.email && hasAddressErrors"
      >
        {{ $t('addressPopup.isRequired', {type: $t('addressPopup.email') }) }}
      </span>
      <span
        class="error"
        v-else-if="invalidEmail && hasAddressErrors"
      >
        {{ $t('contact.invalidEmail') }}
      </span>
    </div>

    <div class="flex">

      <div class="input-wrap" :class="{invalid: !addressData.name && hasAddressErrors}">
        <label>
          {{ $t('addressPopup.name') }}
        </label>
        <input
          type="text"
          v-model="addressData.name"
        />
        <span
          class="error"
          v-if="!addressData.name && hasAddressErrors"
        >
          {{ $t('addressPopup.isRequired', {type: $t('addressPopup.name')}) }}
        </span>
      </div>

      <div
        v-if="phoneList"
        class="input-wrap"
        :class="{invalid: !addressData.phone && hasAddressErrors}"
      >
        <label>&nbsp;</label>
        <div class="input-text">
          <span>
            {{ phoneList[addressData.country] }}
          </span>
          <input
            type="text"
            v-model="addressData.phone"
          />
        </div>
        <span
          class="error"
          v-if="!addressData.phone && hasAddressErrors"
        >
          {{ $t('addressPopup.isRequired', {type: $t('addressPopup.phone')}) }}
        </span>
      </div>
    </div>

    <div
      class="input-wrap"
      :class="{invalid: !addressData.address_1 && hasAddressErrors}"
    >
      <label>
        {{ $t('addressPopup.address') }}
      </label>
      <input
        class="mb-10"
        type="text"
        v-model="addressData.address_1"
        :placeholder="$t('addressPopup.addressPlaceholder')"
      />
      <input
        type="text"
        v-model="addressData.address_2"
        :placeholder="$t('addressPopup.address2Placeholder')"
      />
      <span
        class="error"
        v-if="!addressData.address_1 && hasAddressErrors"
      >
        {{ $t('addressPopup.isRequired', {type: $t('addressPopup.address')}) }}
      </span>
    </div>

    <div class="flex block-xxs">
      <div
        class="input-wrap"
        :class="{invalid: !addressData.city && hasAddressErrors}"
      >
        <label>
          {{ $t('addressPopup.city') }}
        </label>
        <input
          type="text"
          v-model="addressData.city"
        />
        <span
          class="error"
          v-if="!addressData.city && hasAddressErrors"
        >
          {{ $t('addressPopup.isRequired', {type: $t('addressPopup.city')}) }}
        </span>
      </div>

      <div
        class="input-wrap"
        :class="{invalid: !addressData.zip && hasAddressErrors}"
      >
        <label>
          {{ $t('addressPopup.zipCode') }}
        </label>
        <input
          type="text"
          v-model="addressData.zip"
        />
        <span
          class="error"
          v-if="!addressData.zip && hasAddressErrors"
        >
          {{ $t('addressPopup.isRequired', {type: $t('addressPopup.zipCode')}) }}
        </span>
      </div>

      <div
        v-if="Object.keys(states).length"
        class="input-wrap"
      >
        <label>
          {{ $t('addressPopup.state') }}
        </label>
        <dropdown
          :selected-key="addressData.state"
          :options="states"
          key-name="name"
          @clicked="selectState"
        />
      </div>
    </div>

    <div class="input-wrap">
      <label>
        {{ $t('shipping.instruction') }}
      </label>
      <textarea
        v-model="addressData.delivery_instruction"
      />
    </div>

    <div class="flex start mlr-0 gap-10">
      <button
        v-if="editing"
        aria-label="submit"
        class="outline-btn plr-30 plr-sm-15"
        @click.prevent="clearData"
      >
        {{ $t('addressPopup.cancel') }}
      </button>
      <ajax-button
        class="primary-btn plr-30 plr-sm-15"
        :fetching-data="submittingAddressData"
        :loading-text="$t('addressPopup.saving')"
        :text=" $t('addressPopup.thisAddress', {type: editing > 0 ? $t('addressPopup.update') : $t('addressPopup.save')})"
      />
    </div>
  </form>
</template>

<script>
  import util from '~/mixin/util'
  import validation from '~/mixin/validation'
  import PopOver from '~/components/PopOver'
  import Dropdown from '~/components/Dropdown'
  import {mapGetters, mapActions} from 'vuex'
  import addressHelper from '~/mixin/addressHelper'
  import AjaxButton from "~/components/AjaxButton"
  import Spinner from "~/components/Spinner";

  export default {
    name: 'ShippingAddressPopup',
    data() {
      return {
        states: {},
        addressData: null,
        loading: false,
        hasAddressErrors: false,
        dropdownOpen: false,
        submittingAddressData: false
      }
    },
    watch: {
      location() {
        this.settingCountry()
      },
      profile() {
        this.addressData.name = this.profile.name
        this.addressData.email = this.profile.email
      },
    },
    props: {
      address: {
        type: Object,
        default() {
          return null
        }
      }
    },
    components: {
      Spinner,
      AjaxButton,
      PopOver,
      Dropdown
    },
    computed: {
      invalidEmail() {
        return !this.isValidEmail(this.addressData?.email)
      },
      emailValid() {
        return this.addressData.email && !this.invalidEmail
      },
      phoneCode() {
        return this.phoneList[this.addressData?.country]
      },
      editing() {
        return this.addressData && this.addressData.id
      },
      ...mapGetters('user', ['profile']),
      ...mapGetters('language', ['langCode']),
      ...mapGetters('resource', ['countryList', 'phoneList']),
      ...mapGetters('common', ['location'])
    },
    mixins: [util, validation, addressHelper],
    methods: {
      async savingAddressData() {
        await this.addressAction()

        if (!this.hasAddressErrors) {
          this.$emit('close')
        }
      },
      settingCountry() {
        this.addressData.country = this.addressData.country.trim() !== '' ? this.addressData.country.trim() : this.location.countryCode

        this.states = this.addressData?.country ? this.countryList[this.addressData.country].states : ''
        this.addressData.state = this.addressData?.state?.trim() !== '' ? this.addressData?.state?.trim() : this.location.region
      },
      selectedCountry(evt) {
        this.addressData = {...this.addressData, ...{country: evt.value.code2}}
        this.states = evt.value.states
        this.addressData.state = Object.keys(evt.value.states).length ? Object.values(evt.value.states)[0]?.code : ''
      },
      selectedState(evt) {
        this.addressData.state = evt.value.code
      },
      ...mapActions('resource', ['setCountryList', 'setPhoneList']),
      ...mapActions('user', ['userAddressAction', 'getUserToken']),
      ...mapActions('common', ['fetchLocation', 'setToastMessage', 'setToastError', 'getRequest']),
      ...mapActions('order', ['ratingReviewAction', 'ratingReviewFind']),
    },
    created() {
    },
    async mounted() {

      if (!this.countryList || !this.phoneList) {
        this.loading = true

        const {data} = await this.getRequest({
          params: null,
          lang: this.langCode,
          api: 'countriesPhones'
        })

        this.setCountryList(data?.countries)
        this.setPhoneList(data?.phones)
        this.loading = false
      }


      if(this.address){
        this.addressData = {...this.addressData, ...this.address}
      } else {

        this.addressData = {
          id: '',
          city: '',
          email: '',
          name: '',
          phone: '',
          country: '',
          state: '',
          zip: '',
          address_1: '',
          address_2: ''
        }

        this.$nextTick(() => {
          if (this.profile) {
            this.addressData.name = this.profile.name
            this.addressData.email = this.profile.email
          }
        })
      }

      if (!this.addressData.country) {
        this.settingCountry()
      } else {
        this.states = this.addressData?.country ? this.countryList[this.addressData.country].states : ''
        this.addressData.state = this.addressData?.state?.trim() !== '' ? this.addressData?.state?.trim() : this.location.region
      }
    }


  }
</script>

